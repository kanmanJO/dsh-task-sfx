/**
 * 任务完成音效与提醒 —— Host 半。
 *
 * 这里只做三件事：
 *   1. 盯着会话日志里的 `turn/end`：一轮回复结束就是「任务完成」，据此起一个倒计时（时长可在面板里改，默认 5 分钟）；
 *   2. 盯着 `user/message` / `turn/start` / `session/created`：用户有新消息、新任务、新对话就清掉倒计时；
 *   3. 给面板（client.js）开一条同源 HTTP 路由：读写开关、改提醒时长、上传/删除音频、把上面这些事件推给页面。
 *
 * 为什么不在这里放音频：Host 没有扬声器，播放只能在页面里做。所以 Host 只负责「判定 + 记账」，
 * 页面轮询事件、放音、显示倒计时。
 *
 * 所有数据都在 <DSH home>/task-sfx/ 下（config.json + sounds/），与插件代码分开存放：
 * 卸载、升级、重装插件都不会丢音频和开关。
 */
import {
  createReadStream,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { basename, dirname, extname, join } from 'node:path'

export const name = 'dsh-task-sfx'

/** 面板需要一条同源 HTTP 路由；没有它插件什么也做不了。 */
export const inject = ['webServer']

/** 本插件的 API 前缀；页面用相对地址访问，所以永远与界面同源。 */
const ROUTE_PREFIX = '/task-sfx/api'

/** 单个音频上限：一首提示音没必要更大。 */
const MAX_UPLOAD = 40 * 1024 * 1024
/** 面板发的 JSON 很小，给足余地即可。 */
const MAX_JSON = 64 * 1024
/** 事件环形缓冲：页面最多晚到这么久，再多就让它重新拉一次状态。 */
const KEEP_EVENTS = 400
/** A 池最多保留多少个音效。 */
const MAX_POOL = 200
/** 默认提醒间隔（秒）：5 分钟。 */
const DEFAULT_SECONDS = 300
/** 提醒间隔的可调范围（秒）：1 秒到 12 小时。 */
const MIN_SECONDS = 1
const MAX_SECONDS = 43_200

/**
 * 插件配置（cordis.patch.yml）里写的间隔，只当作「还没在面板里设过」时的初值。
 * 一旦面板写过一次，config.json 里的值就是唯一真相。
 */
let defaultSeconds = DEFAULT_SECONDS

/** 秒数的合法化：非正数、NaN 一律退回 fallback，其余夹到范围内并取整（秒按整数算）。 */
function normalizeSeconds(value, fallback) {
  const raw = Number(value)
  const base = Number.isFinite(fallback) && fallback > 0 ? fallback : DEFAULT_SECONDS
  if (!Number.isFinite(raw) || raw <= 0) return base
  return Math.round(Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, raw)))
}

/** 认识的音频后缀 → MIME。只按后缀收，后缀不在表里就拒收，免得存一堆放不出来的文件。 */
const AUDIO_TYPES = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  m4b: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  wav: 'audio/wav',
  wave: 'audio/wav',
  ogg: 'audio/ogg',
  oga: 'audio/ogg',
  opus: 'audio/ogg',
  flac: 'audio/flac',
  webm: 'audio/webm',
  weba: 'audio/webm',
  aif: 'audio/aiff',
  aiff: 'audio/aiff',
  caf: 'audio/x-caf',
  wma: 'audio/x-ms-wma',
}

/** DSH 的家目录：优先 DSH_HOME，其次 profile 目录的上一级，最后退回 ~/.dsh。 */
function dshHome() {
  const explicit = process.env.DSH_HOME
  if (typeof explicit === 'string' && explicit !== '') return explicit
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir !== '') {
    const parent = dirname(profileDir)
    return basename(parent) === 'profiles' ? dirname(parent) : parent
  }
  const home = process.env.HOME || process.env.USERPROFILE || homedir()
  return join(home, '.dsh')
}

/** 插件数据目录：音频与开关都在这里，跟插件代码（可能被重装）分开。 */
function pluginDir() {
  return join(dshHome(), 'task-sfx')
}
function soundsDir() {
  return join(pluginDir(), 'sounds')
}
function statePath() {
  return join(pluginDir(), 'config.json')
}

/** 一个音效条目的合法化：id 只用安全字符，后缀只留字母数字，其余缺省补齐。 */
function normalizeItem(input) {
  if (input === null || typeof input !== 'object') return null
  const id = typeof input.id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(input.id) ? input.id : null
  if (id === null) return null
  const ext = (typeof input.ext === 'string' ? input.ext : '').toLowerCase().replace(/[^a-z0-9]/g, '')
  return {
    id,
    name:
      typeof input.name === 'string' && input.name.trim() !== ''
        ? input.name.slice(0, 200)
        : `sound${ext === '' ? '' : `.${ext}`}`,
    ext: ext === '' ? 'bin' : ext,
    mime: AUDIO_TYPES[ext] || 'application/octet-stream',
    size: Number.isFinite(input.size) && input.size > 0 ? Math.trunc(input.size) : 0,
    addedAt: Number.isFinite(input.addedAt) ? Math.trunc(input.addedAt) : Date.now(),
  }
}

/** 状态的合法化：字段缺了就补默认，类型不对就丢掉，绝不让一份坏文件把插件弄崩。 */
function normalize(input) {
  const source = input !== null && typeof input === 'object' ? input : {}
  const pool = Array.isArray(source.pool)
    ? source.pool.map(normalizeItem).filter((item) => item !== null)
    : []
  // C 池：需要授权时随机播的那一组。老配置里没有这个键，读出来就是空池。
  const poolC = Array.isArray(source.poolC)
    ? source.poolC.map(normalizeItem).filter((item) => item !== null)
    : []
  // 两个开关各管一路：A = 回复结束的完成音效，B = 静默超时的提醒。
  // 老版本只存一个 enabled，读到时按「两个都跟着它」迁移，用户升级后行为不变。
  const legacy = typeof source.enabled === 'boolean' ? source.enabled : null
  // 间隔的老字段是 minutes（浮点分钟）：读到就换算成秒，之后一律按秒存，两种旧文件都能平滑升级。
  const legacySeconds =
    source.seconds === undefined || source.seconds === null
      ? Number.isFinite(Number(source.minutes))
        ? Number(source.minutes) * 60
        : undefined
      : source.seconds
  return {
    enabledA: Boolean(typeof source.enabledA === 'boolean' ? source.enabledA : legacy),
    enabledB: Boolean(typeof source.enabledB === 'boolean' ? source.enabledB : legacy),
    // C 没有历史包袱：老配置里根本没有这个键，默认关着，不替用户擅自开始响。
    enabledC: Boolean(typeof source.enabledC === 'boolean' ? source.enabledC : null),
    seconds: normalizeSeconds(legacySeconds, defaultSeconds),
    pool: pool.slice(0, MAX_POOL),
    poolC: poolC.slice(0, MAX_POOL),
    reminder: normalizeItem(source.reminder),
  }
}

/** 读状态；文件不存在、读不了、坏了，一律当作「还没配」。 */
function readState() {
  try {
    const raw = readFileSync(statePath(), 'utf8')
    // 有些编辑器会把 BOM 写进文件，JSON.parse 见到它会直接抛错：先剥掉，别因此把整份设置当成空的。
    return normalize(JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw))
  } catch {
    return normalize(null)
  }
}

/** 写状态：先写临时文件再 rename，断电或崩溃不会留下半截 JSON。 */
function writeState(next) {
  mkdirSync(soundsDir(), { recursive: true })
  const file = statePath()
  const temp = `${file}.${process.pid}.tmp`
  writeFileSync(temp, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  renameSync(temp, file)
}

/** 删掉一个音效对应的文件；文件已经不在也无所谓。 */
function removeFile(item) {
  if (item === null || typeof item !== 'object' || typeof item.id !== 'string') return
  try {
    unlinkSync(join(soundsDir(), `${item.id}.${item.ext}`))
  } catch {
    /* 已经没了 */
  }
}

/**
 * 事件流：页面每秒来拉一次「上次序号之后发生了什么」。
 *
 * 用轮询而不是 SSE：宿主换实现、反向代理、页面重连都不会把推送悄悄断掉，
 * 而这里要的只是「一秒内到达」，轮询完全够。
 */
const events = []
let seqCounter = 0
/** 待触发的提醒：只有最近一次任务完成的那一个。null 表示没有待响的倒计时。 */
let pending = null

function pushEvent(type, data) {
  seqCounter += 1
  const event = { seq: seqCounter, type, at: Date.now(), data: data === undefined ? {} : data }
  events.push(event)
  if (events.length > KEEP_EVENTS) events.splice(0, events.length - KEEP_EVENTS)
  return event
}

/** 丢掉待触发的提醒，并告诉页面「别响了」。 */
function clearPending(reason) {
  pending = null
  pushEvent('activity', { reason })
}

/** 当前给页面的快照：开关、提醒时长、两个池、待触发的倒计时、事件序号。 */
function snapshot() {
  const state = readState()
  const now = Date.now()
  // 早就过期又没人认领的倒计时就地回收，免得状态里永远挂着一个陈年 deadline。
  if (pending !== null && now >= pending.deadline + 60_000) pending = null
  return {
    enabledA: state.enabledA,
    enabledB: state.enabledB,
    enabledC: state.enabledC,
    reminderSeconds: state.seconds,
    secondsMin: MIN_SECONDS,
    secondsMax: MAX_SECONDS,
    pool: state.pool,
    poolC: state.poolC,
    reminder: state.reminder,
    pending:
      pending === null
        ? null
        : { deadline: pending.deadline, turn: pending.turn, expired: now >= pending.deadline },
    seq: seqCounter,
  }
}

/** 回一段 JSON；面板只需要这一种响应。 */
function sendJson(res, status, body) {
  const payload = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(payload)
}

/** 读完请求体：超过上限就抛，让外层回 400。 */
async function readBuffer(req, limit) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks)
}

/** 读 JSON 请求体。 */
async function readJsonBody(req) {
  const raw = (await readBuffer(req, MAX_JSON)).toString('utf8')
  if (raw.trim() === '') return {}
  const parsed = JSON.parse(raw)
  return parsed !== null && typeof parsed === 'object' ? parsed : {}
}

/**
 * 「任务完成」的判定。
 *
 * 只认「根会话」：子代理自己也会一轮一轮地结束，那是任务内部的事，不该每次都响一下。
 * 根会话的标志是 header 上既没有 parentSession，也不是 origin: 'subagent'。
 */
function onSessionEvent(session, event) {
  const header = session !== null && typeof session === 'object' ? session.header : null
  if (header === null || typeof header !== 'object') return
  if (header.parentSession !== undefined || header.origin === 'subagent') return
  if (event === null || typeof event !== 'object') return

  if (event.type === 'turn/end') {
    const reason = event.data && event.data.reason ? event.data.reason : null
    const kind = reason && typeof reason.kind === 'string' ? reason.kind : 'completed'
    // 用户自己按了停止：这不是「任务完成」，不值得响一声，也不该开始倒计时。
    if (kind === 'aborted') {
      clearPending('aborted')
      return
    }
    const state = readState()
    const now = Date.now()
    // B 关着就不记账：没有倒计时，自然也不会补响。A 那一路仍要通知页面。
    pending = state.enabledB
      ? {
          deadline: now + state.seconds * 1000,
          at: now,
          turn: event.data && typeof event.data.turn === 'number' ? event.data.turn : null,
          sessionId: typeof session.id === 'string' ? session.id : '',
        }
      : null
    pushEvent('task-end', {
      deadline: pending === null ? null : pending.deadline,
      turn: pending === null ? null : pending.turn,
      reason: kind,
    })
    return
  }

  if (event.type === 'user/message') {
    clearPending('user-message')
    return
  }

  if (event.type === 'turn/start') {
    clearPending('task-start')
  }
}

/** 拉事件：`?since=N` 返回 N 之后的事件；缓冲区已经滚掉 N 时回 reset，让页面重新拉一次状态。 */
function pollEvents(url) {
  const raw = url.searchParams.get('since')
  const since = raw === null ? 0 : Number(raw)
  if (!Number.isFinite(since) || since < 0) throw new Error('invalid since')
  const oldest = events.length > 0 ? events[0].seq : seqCounter + 1
  const reset = since > seqCounter || since < oldest - 1
  return {
    seq: seqCounter,
    reset,
    events: reset ? [] : events.filter((event) => event.seq > since),
  }
}

/** 按 id 找音效条目：两个池一起找。 */
function findItem(id) {
  const state = readState()
  const found = state.pool.find((item) => item.id === id)
  if (found !== undefined) return found
  const foundC = state.poolC.find((item) => item.id === id)
  if (foundC !== undefined) return foundC
  if (state.reminder !== null && state.reminder.id === id) return state.reminder
  return null
}

/** 回放音频：支持单段 Range，<audio> 想拖动进度条也不会被拒。 */
function serveAudio(req, res, rawId) {
  let id = ''
  try {
    id = decodeURIComponent(rawId === undefined || rawId === null ? '' : String(rawId))
  } catch {
    sendJson(res, 400, { error: 'malformed sound id' })
    return
  }
  const item = id === '' ? null : findItem(id)
  if (item === null) {
    sendJson(res, 404, { error: 'sound not found' })
    return
  }
  const file = join(soundsDir(), `${item.id}.${item.ext}`)
  let info
  try {
    info = statSync(file)
  } catch {
    sendJson(res, 404, { error: 'sound file missing' })
    return
  }
  const headers = {
    'content-type': item.mime,
    'accept-ranges': 'bytes',
    // id 每次上传都是新的，所以这份字节永远不变，可以放心让浏览器长期缓存。
    'cache-control': 'public, max-age=31536000, immutable',
  }
  const range = typeof req.headers.range === 'string' ? req.headers.range : ''
  const match = /^bytes=(\d*)-(\d*)$/.exec(range)
  if (match !== null) {
    const hasStart = match[1] !== ''
    const hasEnd = match[2] !== ''
    let start = hasStart ? Number(match[1]) : 0
    let end = hasEnd ? Number(match[2]) : info.size - 1
    if (!hasStart) {
      // bytes=-N：最后 N 个字节
      start = Math.max(0, info.size - (hasEnd ? Number(match[2]) : 0))
      end = info.size - 1
    }
    if (Number.isFinite(start) && Number.isFinite(end) && start <= end && start < info.size) {
      end = Math.min(end, info.size - 1)
      res.writeHead(206, {
        ...headers,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'content-length': String(end - start + 1),
      })
      createReadStream(file, { start, end }).pipe(res)
      return
    }
    res.writeHead(416, { ...headers, 'content-range': `bytes */${info.size}` })
    res.end()
    return
  }
  res.writeHead(200, { ...headers, 'content-length': String(info.size) })
  createReadStream(file).pipe(res)
}

/** 上传：请求体就是原始字节，文件名走 `x-sfx-name`（URI 编码过）。 */
async function handleUpload(req, url) {
  const rawSlot = url.searchParams.get('slot')
  const slot = rawSlot === 'b' ? 'b' : rawSlot === 'c' ? 'c' : 'pool'
  const header = req.headers['x-sfx-name']
  let name = ''
  try {
    name = decodeURIComponent(typeof header === 'string' ? header : '')
  } catch {
    name = typeof header === 'string' ? header : ''
  }
  name = basename(name.replace(/[\\/]/g, '_')).slice(0, 200)
  const ext = extname(name === '' ? '' : name).replace(/^\./, '').toLowerCase()
  const mime = AUDIO_TYPES[ext]
  if (mime === undefined) {
    throw new Error(
      ext === ''
        ? `missing audio extension; supported: ${Object.keys(AUDIO_TYPES).join(', ')}`
        : `unsupported audio type "${ext}"; supported: ${Object.keys(AUDIO_TYPES).join(', ')}`,
    )
  }
  const bytes = await readBuffer(req, MAX_UPLOAD)
  if (bytes.length === 0) throw new Error('empty file')

  const id = `snd_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`
  mkdirSync(soundsDir(), { recursive: true })
  writeFileSync(join(soundsDir(), `${id}.${ext}`), bytes)

  const item = {
    id,
    name: name === '' ? `sound.${ext}` : name,
    ext,
    mime,
    size: bytes.length,
    addedAt: Date.now(),
  }
  const state = readState()
  let next
  if (slot === 'pool') {
    next = { ...state, pool: [...state.pool, item].slice(0, MAX_POOL) }
  } else if (slot === 'c') {
    next = { ...state, poolC: [...state.poolC, item].slice(0, MAX_POOL) }
  } else {
    // B 只有一个：换新的就把旧的连文件一起扔掉，不留下谁也不认领的字节。
    if (state.reminder !== null) removeFile(state.reminder)
    next = { ...state, reminder: item }
  }
  writeState(next)
  pushEvent('state', { enabledA: next.enabledA, enabledB: next.enabledB, enabledC: next.enabledC })
  return item
}

/** 路由总入口：一条前缀路由分发所有动作。 */
async function handleRoute(req, res) {
  try {
    const url = new URL(req.url === undefined || req.url === null ? ROUTE_PREFIX : req.url, 'http://localhost')
    const action = url.pathname.slice(ROUTE_PREFIX.length).replace(/^\/+/, '')
    const method = String(req.method === undefined || req.method === null ? 'GET' : req.method).toUpperCase()

    if (action === 'state') {
      if (method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      sendJson(res, 200, snapshot())
      return
    }

    if (action === 'events') {
      if (method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      sendJson(res, 200, pollEvents(url))
      return
    }

    if (action === 'toggle') {
      if (method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      const body = await readJsonBody(req)
      const state = readState()
      const key =
        body.slot === 'b' ? 'enabledB' : body.slot === 'a' ? 'enabledA' : body.slot === 'c' ? 'enabledC' : null
      if (key === null) {
        sendJson(res, 400, { error: 'slot must be "a", "b" or "c"' })
        return
      }
      const enabled = body.enabled === undefined ? !state[key] : Boolean(body.enabled)
      writeState({ ...state, [key]: enabled })
      // B 一动就作废旧倒计时：刚打开时不该替「上一次任务」补响；关掉就更不该再响。
      if (key === 'enabledB') pending = null
      pushEvent('state', { enabledA: state.enabledA, enabledB: state.enabledB, enabledC: state.enabledC, [key]: enabled })
      sendJson(res, 200, snapshot())
      return
    }

    if (action === 'seconds') {
      if (method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      const body = await readJsonBody(req)
      const raw = Number(body.seconds)
      if (!Number.isFinite(raw) || raw <= 0) {
        sendJson(res, 400, { error: 'seconds must be a positive number' })
        return
      }
      const state = readState()
      const seconds = normalizeSeconds(raw, state.seconds)
      writeState({ ...state, seconds })
      // 倒计时正在走的话按新时长重算：面板上显示的和真正会响的那一刻必须一致。
      if (pending !== null) pending.deadline = pending.at + seconds * 1000
      pushEvent('state', { enabledA: state.enabledA, enabledB: state.enabledB, enabledC: state.enabledC, seconds })
      sendJson(res, 200, snapshot())
      return
    }

    if (action === 'upload') {
      if (method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      await handleUpload(req, url)
      sendJson(res, 200, snapshot())
      return
    }

    if (action === 'delete') {
      if (method !== 'POST') {
        res.setHeader('allow', 'POST')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      const body = await readJsonBody(req)
      const state = readState()
      let next
      if (body.slot === 'b') {
        if (state.reminder !== null) removeFile(state.reminder)
        next = { ...state, reminder: null }
      } else if (body.slot === 'c') {
        const removedC = state.poolC.filter((item) => item.id === body.id)
        for (const item of removedC) removeFile(item)
        next = { ...state, poolC: state.poolC.filter((item) => item.id !== body.id) }
      } else {
        const removed = state.pool.filter((item) => item.id === body.id)
        for (const item of removed) removeFile(item)
        next = { ...state, pool: state.pool.filter((item) => item.id !== body.id) }
      }
      writeState(next)
      pushEvent('state', { enabledA: next.enabledA, enabledB: next.enabledB, enabledC: next.enabledC })
      sendJson(res, 200, snapshot())
      return
    }

    if (action.startsWith('audio/')) {
      if (method !== 'GET') {
        res.setHeader('allow', 'GET')
        sendJson(res, 405, { error: `method not allowed: ${method}` })
        return
      }
      serveAudio(req, res, action.slice('audio/'.length))
      return
    }

    sendJson(res, 404, { error: `unknown action: ${action === '' ? '(none)' : action}` })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (res.headersSent) {
      try {
        res.end()
      } catch {
        /* 已经断了 */
      }
      return
    }
    sendJson(res, 400, { error: message })
  }
}

/** 插件入口：一条 API 路由 + 三个事件监听（会话、审批）。 */
export function apply(ctx, config) {
  // 配置里的间隔只是初值；面板改过之后以 config.json 为准。老配置键 reminderMinutes（分钟）也认。
  const conf = config !== null && typeof config === 'object' ? config : {}
  const configured = Number.isFinite(Number(conf.reminderSeconds))
    ? Number(conf.reminderSeconds)
    : Number.isFinite(Number(conf.reminderMinutes))
      ? Number(conf.reminderMinutes) * 60
      : NaN
  defaultSeconds = normalizeSeconds(configured, DEFAULT_SECONDS)

  mkdirSync(soundsDir(), { recursive: true })

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PREFIX, handler: (req, res) => handleRoute(req, res) }),
    'task-sfx: panel api',
  )

  // 一轮回复结束 = 任务完成；用户新消息 / 新任务 / 新对话 = 清掉倒计时。
  ctx.on('session/event', (session, event) => onSessionEvent(session, event))

  // 新开一个会话（新对话）同样算「有新动作」。
  ctx.on('session/created', (session) => {
    const header = session !== null && typeof session === 'object' ? session.header : null
    if (header === null || typeof header !== 'object') return
    if (header.parentSession !== undefined || header.origin === 'subagent') return
    clearPending('new-session')
  })

  // 「需要授权」的那一下：审批请求刚出现就告诉页面响一声 C。
  // 这是 waterfall 事件，监听器必须原样 return next() 把决定权交回 DSH；
  // 提醒本身包在 try/catch 里，任何失败都不允许影响审批流程。
  ctx.on('approval/request', (req, next) => {
    try {
      const state = readState()
      if (state.enabledC && state.poolC.length > 0) {
        pushEvent('approval', {
          toolName: req !== null && typeof req === 'object' && typeof req.toolName === 'string' ? req.toolName : '',
        })
      }
    } catch {
      /* 提醒失败绝不能影响审批本身 */
    }
    return next()
  })
}
