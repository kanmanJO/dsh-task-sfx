#!/usr/bin/env node
/**
 * 冒烟测试：不需要 DSH 运行时，也不需要浏览器。
 *
 * 做法：把插件真身 import 进来，喂一个假的 ctx 收集它注册的路由与会话监听，
 * 再用真的 http 服务器代理那条路由——于是 fetch 打到的是插件自己的代码路径，
 * 只是没有 DSH 在中间。
 *
 *   npm test
 */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/* 每个用例都在自己的临时 DSH home 里跑，绝不碰真实的 ~/.dsh。 */
const home = mkdtempSync(join(tmpdir(), 'dsh-task-sfx-'))
process.env.DSH_HOME = home

const plugin = await import('../index.js')

const listeners = new Map()
const routes = []
const disposers = []

const ctx = {
  effect(setup) {
    const off = setup()
    const dispose = () => {
      if (typeof off === 'function') off()
    }
    disposers.push(dispose)
    return dispose
  },
  on(name, handler) {
    const list = listeners.get(name) ?? []
    list.push(handler)
    listeners.set(name, list)
    return () => {}
  },
  webServer: {
    register(route) {
      routes.push(route)
      return () => {}
    },
  },
}

let passed = 0
function pass(label) {
  passed += 1
  console.log(`ok ${passed} - ${label}`)
}

plugin.apply(ctx, {})

const rootSession = { id: 's-live', header: { id: 's-live', version: 1, createdAt: Date.now(), isSeeded: false } }
const childSession = {
  id: 's-child',
  header: { id: 's-child', version: 1, createdAt: Date.now(), isSeeded: false, parentSession: 's-live', origin: 'subagent' },
}

const server = createServer((req, res) => route.handler(req, res))
const route = routes[0]
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/task-sfx/api`

const getJson = async (path) => {
  const response = await fetch(base + path)
  return { status: response.status, headers: response.headers, body: await response.json() }
}
const postJson = async (path, body) => {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: response.status, body: await response.json() }
}
const getState = () => getJson('/state')

/** 模拟 DSH 往会话日志里追加一条事件，触发插件注册的监听。 */
function fire(type, data, session = rootSession) {
  const event = { type, seq: 1, time: Date.now(), data }
  for (const handler of listeners.get('session/event') ?? []) handler(session, event)
}
function fireTurnEnd(reason = 'completed', session = rootSession) {
  fire('turn/end', { turn: 1, reason: { kind: reason } }, session)
}
/**
 * 模拟 DSH 发起一次审批请求。
 *
 * `approval/request` 是 waterfall 事件：监听器拿到 (req, next)，必须 return next()
 * 把决定权交回 DSH。这里顺便统计 next() 被调用的次数与透传的结果。
 */
async function fireApproval(toolName = 'pwsh') {
  const handlers = listeners.get('approval/request') ?? []
  let nextCalls = 0
  const results = []
  for (const handler of handlers) {
    results.push(
      await handler({ agent: { id: 's-live' }, toolName }, () => {
        nextCalls += 1
        return Promise.resolve('allowed-once')
      }),
    )
  }
  return { results, nextCalls }
}
const listEvents = async (since = 0) => (await getJson(`/events?since=${since}`)).body

const WAV = Buffer.concat([
  Buffer.from('RIFF'),
  Buffer.alloc(4),
  Buffer.from('WAVEfmt '),
  Buffer.alloc(40),
])
const soundsDir = join(home, 'task-sfx', 'sounds')
const statePath = join(home, 'task-sfx', 'config.json')

try {
  /* ---- 路由与默认状态 ---- */
  assert.equal(routes.length, 1, '插件应当只注册一条路由')
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/task-sfx/api')
  assert.ok(readdirSync(soundsDir, { withFileTypes: true }).length === 0, '首次加载应当建好空的 sounds 目录')
  pass('注册一条 /task-sfx/api 前缀路由，并建好数据目录')

  const initial = (await getState()).body
  assert.equal(initial.enabledA, false)
  assert.equal(initial.enabledB, false)
  assert.equal(initial.enabledC, false)
  assert.equal(initial.reminderSeconds, 300)
  assert.equal(initial.secondsMin, 1)
  assert.equal(initial.secondsMax, 43_200)
  assert.deepEqual(initial.pool, [])
  assert.deepEqual(initial.poolC, [])
  assert.equal(initial.reminder, null)
  assert.equal(initial.pending, null)
  pass('GET /state 返回默认快照（三个开关关、300 秒、空池）')

  /* ---- 参数与错误分支 ---- */
  assert.equal((await getJson('/nope')).status, 404)
  const wrongMethod = await getJson('/toggle')
  assert.equal(wrongMethod.status, 405)
  assert.equal(wrongMethod.headers.get('allow'), 'POST')
  assert.equal((await postJson('/toggle', { slot: 'x' })).status, 400)
  assert.equal((await postJson('/seconds', { seconds: 0 })).status, 400)
  assert.equal((await postJson('/seconds', {})).status, 400)
  pass('未知动作 404、方法不符 405、坏参数 400')

  /* ---- 两个开关各自独立 ---- */
  const toggleA = (await postJson('/toggle', { slot: 'a' })).body
  assert.equal(toggleA.enabledA, true)
  assert.equal(toggleA.enabledB, false)
  const toggleB = (await postJson('/toggle', { slot: 'b' })).body
  assert.equal(toggleB.enabledB, true)
  const flipB = (await postJson('/toggle', { slot: 'b', enabled: false })).body
  assert.equal(flipB.enabledB, false)
  assert.equal(flipB.enabledA, true)
  pass('A / B 两个开关互不牵连，也支持显式 enabled')

  /* ---- C 也是独立开关 ---- */
  const toggleC = (await postJson('/toggle', { slot: 'c' })).body
  assert.equal(toggleC.enabledC, true)
  assert.equal(toggleC.enabledA, true)
  assert.equal(toggleC.enabledB, false)
  const flipC = (await postJson('/toggle', { slot: 'c', enabled: false })).body
  assert.equal(flipC.enabledC, false)
  assert.equal(flipC.enabledA, true, '关 C 不该顺手关掉 A')
  pass('C 开关与 A/B 互不牵连，同样支持显式 enabled')

  /* ---- 间隔以秒为单位，带夹取 ---- */
  assert.equal((await postJson('/seconds', { seconds: 12 })).body.reminderSeconds, 12)
  assert.equal((await postJson('/seconds', { seconds: 0.4 })).body.reminderSeconds, 1)
  assert.equal((await postJson('/seconds', { seconds: 99_999 })).body.reminderSeconds, 43_200)
  assert.equal((await postJson('/seconds', { seconds: 45.6 })).body.reminderSeconds, 46)
  pass('POST /seconds 取整并夹到 1–43200')

  /* ---- 任务完成 → 倒计时 ---- */
  await postJson('/seconds', { seconds: 12 })
  await postJson('/toggle', { slot: 'b', enabled: true })
  const before = Date.now()
  fireTurnEnd('completed')
  const armed = (await getState()).body
  assert.ok(armed.pending !== null, 'B 开着时任务完成应当开始倒计时')
  assert.ok(armed.pending.deadline >= before + 12_000, 'deadline 应当落在 12 秒之后')
  assert.ok(armed.pending.deadline <= Date.now() + 12_000)
  assert.equal(armed.pending.expired, false)
  const afterEnd = await listEvents()
  const taskEnd = afterEnd.events.filter((event) => event.type === 'task-end').pop()
  assert.ok(taskEnd !== undefined, '应当推送 task-end 事件')
  assert.equal(taskEnd.data.deadline, armed.pending.deadline)
  assert.equal(taskEnd.data.reason, 'completed')
  pass('turn/end(completed) 按秒数开始倒计时，并推送 task-end')

  /* ---- 用户动作作废倒计时 ---- */
  fire('user/message', { role: 'user', id: 'm1' })
  assert.equal((await getState()).body.pending, null)
  fireTurnEnd('completed')
  assert.ok((await getState()).body.pending !== null)
  fire('turn/start', { turn: 2 })
  assert.equal((await getState()).body.pending, null)
  const afterActivity = await listEvents()
  const reasons = afterActivity.events.filter((event) => event.type === 'activity').map((event) => event.data.reason)
  assert.ok(reasons.includes('user-message'))
  assert.ok(reasons.includes('task-start'))
  pass('用户消息 / 新任务都会立刻作废倒计时')

  /* ---- 主动停止不算任务完成 ---- */
  fireTurnEnd('completed')
  assert.ok((await getState()).body.pending !== null)
  fireTurnEnd('aborted')
  assert.equal((await getState()).body.pending, null)
  pass('turn/end(aborted) 既不算完成，也不留倒计时')

  /* ---- 子代理的回合不响 ---- */
  const seqBeforeChild = (await getState()).body.seq
  fireTurnEnd('completed', childSession)
  const afterChild = (await getState()).body
  assert.equal(afterChild.seq, seqBeforeChild, '子会话的事件不应当产生任何推送')
  pass('子代理会话的 turn/end 被忽略')

  /* ---- B 关着时连倒计时都不建立 ---- */
  await postJson('/toggle', { slot: 'b', enabled: false })
  fireTurnEnd('completed')
  assert.equal((await getState()).body.pending, null)
  const silent = (await listEvents()).events.filter((event) => event.type === 'task-end').pop()
  assert.equal(silent.data.deadline, null, 'B 关着时 task-end 的 deadline 应当是 null')
  pass('B 关着时任务完成不会建立倒计时')

  /* ---- 上传 / 取回 / 删除 ---- */
  await postJson('/toggle', { slot: 'b', enabled: true })
  const upload = await fetch(`${base}/upload?slot=pool`, {
    method: 'POST',
    headers: { 'content-type': 'audio/wav', 'x-sfx-name': encodeURIComponent('smoke 测试.wav') },
    body: WAV,
  })
  assert.equal(upload.status, 200)
  const uploaded = (await upload.json()).pool
  assert.equal(uploaded.length, 1)
  assert.equal(uploaded[0].name, 'smoke 测试.wav')
  assert.equal(uploaded[0].ext, 'wav')
  assert.equal(uploaded[0].mime, 'audio/wav')
  assert.equal(uploaded[0].size, WAV.length)
  assert.ok(existsSync(join(soundsDir, `${uploaded[0].id}.wav`)))
  pass('批量导入接口写入音频文件并登记到池')

  const audio = await fetch(`${base}/audio/${uploaded[0].id}`)
  assert.equal(audio.status, 200)
  assert.equal(audio.headers.get('content-type'), 'audio/wav')
  assert.equal(Number(audio.headers.get('content-length')), WAV.length)
  assert.equal((await audio.arrayBuffer()).byteLength, WAV.length)

  const ranged = await fetch(`${base}/audio/${uploaded[0].id}`, { headers: { range: 'bytes=0-3' } })
  assert.equal(ranged.status, 206)
  assert.equal(ranged.headers.get('content-range'), `bytes 0-3/${WAV.length}`)
  assert.equal((await ranged.arrayBuffer()).byteLength, 4)
  assert.equal((await getJson('/audio/snd_missing')).status, 404)
  pass('音频接口回放字节，并支持单段 Range')

  const badType = await fetch(`${base}/upload?slot=pool`, {
    method: 'POST',
    headers: { 'content-type': 'application/octet-stream', 'x-sfx-name': 'notes.txt' },
    body: WAV,
  })
  assert.equal(badType.status, 400)
  pass('不支持的扩展名被拒绝')

  /* ---- B 槽替换语义 ---- */
  const firstB = await fetch(`${base}/upload?slot=b`, {
    method: 'POST',
    headers: { 'content-type': 'audio/mpeg', 'x-sfx-name': 'reminder-a.mp3' },
    body: WAV,
  })
  const firstBItem = (await firstB.json()).reminder
  const secondB = await fetch(`${base}/upload?slot=b`, {
    method: 'POST',
    headers: { 'content-type': 'audio/mpeg', 'x-sfx-name': 'reminder-b.mp3' },
    body: WAV,
  })
  const secondBItem = (await secondB.json()).reminder
  assert.equal(secondBItem.name, 'reminder-b.mp3')
  assert.notEqual(secondBItem.id, firstBItem.id)
  assert.ok(!existsSync(join(soundsDir, `${firstBItem.id}.mp3`)), '换掉的 B 文件应当被清理')
  pass('B 槽换新文件时旧文件被删除')

  /* ---- C 池：导入、触发、删除 ---- */
  const uploadC = await fetch(`${base}/upload?slot=c`, {
    method: 'POST',
    headers: { 'content-type': 'audio/mpeg', 'x-sfx-name': 'approval-1.mp3' },
    body: WAV,
  })
  assert.equal(uploadC.status, 200)
  const uploadedC = (await uploadC.json()).poolC
  assert.equal(uploadedC.length, 1)
  assert.equal(uploadedC[0].name, 'approval-1.mp3')
  assert.ok(existsSync(join(soundsDir, `${uploadedC[0].id}.mp3`)))
  pass('C 池支持批量导入并单独登记（不混进 A 池）')

  /* C 关着：审批请求静默，但必须把决定原样交回 DSH。 */
  await postJson('/toggle', { slot: 'c', enabled: false })
  const seqBeforeOff = (await getState()).body.seq
  const silentApproval = await fireApproval('pwsh')
  assert.equal(silentApproval.nextCalls, 1, '监听器必须调用 next()')
  assert.deepEqual(silentApproval.results, ['allowed-once'], '审批结果必须原样透传')
  assert.equal((await getState()).body.seq, seqBeforeOff, 'C 关着时不该推任何事件')
  pass('C 关着时审批请求静默，且审批结果原样透传')

  /* C 开着：审批请求刚出现就推一条 approval 事件。 */
  await postJson('/toggle', { slot: 'c', enabled: true })
  const loudApproval = await fireApproval('pwsh')
  assert.deepEqual(loudApproval.results, ['allowed-once'])
  const approvalEvent = (await listEvents()).events.filter((event) => event.type === 'approval').pop()
  assert.ok(approvalEvent !== undefined, 'C 开着时应当推送 approval 事件')
  assert.equal(approvalEvent.data.toolName, 'pwsh')
  pass('审批请求出现的那一刻推送 approval 事件，并带上工具名')

  /* 授权提醒只响一声，不该动 B 的倒计时。 */
  await postJson('/toggle', { slot: 'b', enabled: true })
  fireTurnEnd('completed')
  const armedBefore = (await getState()).body.pending
  assert.ok(armedBefore !== null)
  await fireApproval('pwsh')
  assert.deepEqual((await getState()).body.pending, armedBefore, '授权提醒不该重置或清掉 B 的倒计时')
  pass('授权提醒不影响 B 的倒计时')

  /* 删除 C 池条目 */
  const removedC = (await postJson('/delete', { slot: 'c', id: uploadedC[0].id })).body
  assert.equal(removedC.poolC.length, 0)
  assert.ok(!existsSync(join(soundsDir, `${uploadedC[0].id}.mp3`)))
  pass('删除 C 池条目会同时清掉清单与磁盘文件')

  /* ---- 删除 ---- */
  const afterDelete = (await postJson('/delete', { slot: 'pool', id: uploaded[0].id })).body
  assert.equal(afterDelete.pool.length, 0)
  assert.ok(!existsSync(join(soundsDir, `${uploaded[0].id}.wav`)))
  const clearedB = (await postJson('/delete', { slot: 'b' })).body
  assert.equal(clearedB.reminder, null)
  pass('删除会同时清掉清单与磁盘文件')

  /* ---- 老配置迁移 + BOM 容错 ---- */
  writeFileSync(statePath, '\uFEFF' + JSON.stringify({ enabled: true, minutes: 0.5 }), 'utf8')
  const migrated = (await getState()).body
  assert.equal(migrated.enabledA, true)
  assert.equal(migrated.enabledB, true)
  assert.equal(migrated.enabledC, false, '旧配置里的 enabled 不该顺手把 C 打开')
  assert.equal(migrated.reminderSeconds, 30)
  pass('旧的 enabled / minutes 自动迁移成两个开关与秒，且能读带 BOM 的文件')
  /* 迁移结果要能落盘：随便触发一次写，文件里就该只剩新字段。 */
  await postJson('/toggle', { slot: 'a', enabled: true })
  const normalized = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(normalized.seconds, 30)
  assert.equal(normalized.minutes, undefined)
  assert.equal(normalized.enabled, undefined)
  assert.equal(normalized.enabledA, true)
  pass('迁移后的状态以新字段落盘，旧字段不再残留')

  /* ---- 持久化：新进程读同一份磁盘 ---- */
  const onDisk = JSON.parse(readFileSync(statePath, 'utf8'))
  assert.equal(onDisk.enabledA, true)
  pass('状态以 JSON 落盘，重启即可恢复')
} finally {
  await new Promise((resolve) => server.close(resolve))
  for (const dispose of disposers.reverse()) dispose()
  rmSync(home, { recursive: true, force: true })
  console.log(`\n${passed} checks passed`)
}
