/**
 * 任务完成音效与提醒 —— Client 半。
 *
 * 两处注册，正好落成用户要的样子：
 *   - `sidebar.panellist`：左侧边栏里与「插件」「自动化任务」同级的一个图标项；
 *   - `main`：点图标后主区域显示的设置面板（key 与上面的 id 相同，侧边栏按 id 分发）。
 *
 * 另外在 `apply` 里常驻一台「播放引擎」：每秒向 Host 拉一次事件，收到 task-end 就随机放一个 A 池音效
 * 并起 5 分钟倒计时，收到 activity 就把倒计时清掉。引擎挂在 apply 的 effect 上，与面板是否打开无关。
 */
window.__ModuleLoader__.load({
  id: 'dsh-task-sfx',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** 侧边栏项的 id，同时也是 `main` 面板的 key —— 两者必须一致。 */
    const PANEL_ID = 'task-sfx'
    /** Host 半的路由；相对地址，所以与界面同源。 */
    const API = '/task-sfx/api'
    /** 客户端词典命名空间。 */
    const NS = 'task-sfx'
    /** 轮询间隔：一秒内到达，人耳听不出延迟。 */
    const POLL_MS = 1000
    /** B 卡里的一键预设（秒）：省得每次都敲键盘。 */
    const DELAY_PRESETS = [10, 30, 60, 300, 600]

    const COPY = {
      en: {
        label: 'Task sounds',
        title: 'Task completion sounds & reminder',
        intro:
          'A chime plays when a reply ends, and a reminder plays once if you stay quiet afterwards. Everything here is stored on disk, so it survives a restart.',
        toggleOn: 'On',
        toggleOff: 'Off',
        switchA: 'Completion chime (A)',
        switchAHintOn: 'Every time a reply ends, one sound from the pool below plays at random.',
        switchAHintOff: 'No chime when a reply ends. The pool and its files are kept.',
        switchB: 'Reminder (B)',
        switchBHintOn: 'Plays once if you stay quiet for {sec} after a reply ends.',
        switchBHintOff: 'No reminder, and no countdown is started at all.',
        poolTitle: 'Completion chimes (sound A)',
        poolHint: 'Every time a reply ends, one of these plays at random.',
        poolImport: 'Import audio',
        poolEmpty: 'No chimes yet. Import two or three files and one of them plays at random.',
        reminderTitle: 'Reminder (sound B)',
        reminderHint:
          'If you send nothing, open no new conversation and start no new task for {sec} after a reply ends, this plays once.',
        reminderImport: 'Choose a file',
        reminderEmpty: 'No reminder sound yet. Pick one file here.',
        delayLabel: 'Reminder delay',
        delayUnit: 'sec',
        unitSec: 's',
        unitMin: 'min',
        delayRangeHint:
          'Anything from {lo} to {hi} seconds. Takes effect at once, including a countdown that is already running.',
        delayInvalid: 'Enter a whole number of seconds between {lo} and {hi}.',
        preview: 'Play',
        remove: 'Delete',
        countdown: 'Reminder in {time}',
        countdownHint: 'Any new message, task or conversation cancels it.',
        idleHint: 'The countdown starts when a reply ends and fires at most once per task.',
        idleSilent: 'Both switches are off, so nothing will play.',
        uploading: 'Uploading…',
        uploadFailed: 'Upload failed: {error}',
        saveFailed: 'Could not save: {error}',
        removeFailed: 'Could not delete: {error}',
        playFailed: 'Could not play: {error}',
        loadFailed: 'Could not read the settings: {error}',
        loading: 'Loading…',
        retry: 'Retry',
        stored: 'Files live in the plugin data directory (<DSH home>/task-sfx) and survive restarts.',
        count: '{n} file(s)',
      },
      zh: {
        label: '任务音效',
        title: '任务完成音效与提醒',
        intro:
          '每次回复结束时随机播一个完成音效；之后如果你一直没动静，再补响一次提醒。这里的设置和音频都存在磁盘上，重启 DSH 也还在。',
        toggleOn: '开',
        toggleOff: '关',
        switchA: '任务完成音效（A）',
        switchAHintOn: '每次回复结束，从下面的音效池里随机播一个。',
        switchAHintOff: '回复结束不播完成音效，音效池与文件都保留。',
        switchB: '提醒音效（B）',
        switchBHintOn: '回复结束后 {sec} 没有任何动静，补响一次提醒。',
        switchBHintOff: '不播提醒，也不会开始倒计时。',
        poolTitle: '任务完成音效池（音效 A）',
        poolHint: '每次回复结束，从下面这些里随机播一个。',
        poolImport: '批量导入音频',
        poolEmpty: '还没有音效。导入两三个文件，之后会随机播其中一个。',
        reminderTitle: '提醒音效（音效 B）',
        reminderHint: '回复结束后 {sec} 内没有新消息、也没有新任务/新对话，就播这一次。',
        reminderImport: '选择提醒音效',
        reminderEmpty: '还没有提醒音效，在这里单独选一个文件。',
        delayLabel: '提醒间隔',
        delayUnit: '秒',
        unitSec: '秒',
        unitMin: '分',
        delayRangeHint: '可设 {lo}–{hi} 秒。改完立刻生效，连正在走的倒计时也会按新时长重算。',
        delayInvalid: '请输入 {lo}–{hi} 之间的整数秒。',
        preview: '试听',
        remove: '删除',
        countdown: '提醒将在 {time} 后播放',
        countdownHint: '期间发新消息、开新对话或起新任务都会取消。',
        idleHint: '回复结束才开始倒计时，同一次任务最多响一次。',
        idleSilent: '两个开关都关着，什么都不会播。',
        uploading: '上传中…',
        uploadFailed: '上传失败：{error}',
        saveFailed: '保存失败：{error}',
        removeFailed: '删除失败：{error}',
        playFailed: '播放失败：{error}',
        loadFailed: '读取设置失败：{error}',
        loading: '读取中…',
        retry: '重试',
        stored: '文件存在插件数据目录（<DSH 家目录>/task-sfx），重启不会丢。',
        count: '共 {n} 个',
      },
    }

    /** 由 apply 注入：拿到就能跟着界面语言走。 */
    let localeService = null

    /** 取一句文案；带 {name} 占位符的用 vars 填。 */
    const translate = (key, vars) => {
      let table = COPY.en
      if (localeService !== null) {
        try {
          const active = localeService.getSnapshot().active
          if (typeof active === 'string' && /^zh/i.test(active)) table = COPY.zh
        } catch {
          /* 快照取不到就退回英文 */
        }
      } else if (typeof document !== 'undefined' && /^zh/i.test(document.documentElement.lang || '')) {
        table = COPY.zh
      }
      let text = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : COPY.en[key]
      if (typeof text !== 'string') text = String(key)
      if (vars !== undefined && vars !== null) {
        for (const name of Object.keys(vars)) text = text.split(`{${name}}`).join(String(vars[name]))
      }
      return text
    }

    /** 一句人话的错误描述。 */
    const describe = (error) => (error && error.message) || String(error)

    /**
     * 面板与引擎共享的一小块状态。
     *
     * 引擎（apply 里的常驻 effect）改它，面板订阅它；两边都不需要知道对方存在。
     */
    const store = {
      /** Host 的最近一次快照：{ enabledA, enabledB, reminderSeconds, pool, reminder, pending, seq }。 */
      state: null,
      /** 本页正在等的提醒：{ deadline } 或 null。 */
      pending: null,
      /** 最近一次播放/加载失败的原因，面板上直接显示，省得翻控制台。 */
      lastError: null,
      listeners: new Set(),
      emit() {
        for (const listener of Array.from(this.listeners)) {
          try {
            listener()
          } catch {
            /* 某个订阅者坏了不该拦住别的 */
          }
        }
      },
      subscribe(listener) {
        this.listeners.add(listener)
        return () => {
          this.listeners.delete(listener)
        }
      },
    }

    /** 跟着界面语言重渲染。 */
    function useLocaleRevision() {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        if (localeService === null) return undefined
        const unsubscribe = localeService.subscribe(() => force((count) => count + 1))
        return typeof unsubscribe === 'function' ? unsubscribe : undefined
      }, [])
    }

    /** 跟着共享状态重渲染。 */
    function useStore() {
      const [, force] = React.useState(0)
      React.useEffect(() => store.subscribe(() => force((count) => count + 1)), [])
      return store
    }

    /** 只在真需要的时候每 500ms 醒一次（倒计时在走的时候）。 */
    function useTick(active) {
      const [, force] = React.useState(0)
      React.useEffect(() => {
        if (!active) return undefined
        const timer = setInterval(() => force((count) => count + 1), 500)
        return () => clearInterval(timer)
      }, [active])
    }

    const formatClock = (milliseconds) => {
      const total = Math.max(0, Math.round(milliseconds / 1000))
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
    }

    /** 秒数的人话：45 秒 / 5 分 / 1 分 30 秒（跟着界面语言走）。 */
    const formatDuration = (value) => {
      const total = Math.max(0, Math.round(Number(value)))
      if (!Number.isFinite(total)) return ''
      const unitSec = translate('unitSec')
      const unitMin = translate('unitMin')
      if (total < 60) return `${total} ${unitSec}`
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      if (seconds === 0) return `${minutes} ${unitMin}`
      return `${minutes} ${unitMin} ${seconds} ${unitSec}`
    }

    const formatSize = (bytes) => {
      const size = Number(bytes)
      if (!Number.isFinite(size) || size <= 0) return ''
      if (size < 1024) return `${size} B`
      if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
      return `${(size / (1024 * 1024)).toFixed(1)} MB`
    }

    /** 一次 GET；非 2xx 或坏 JSON 都当作失败抛出。 */
    async function getJson(action) {
      const response = await fetch(`${API}/${action}`, {
        method: 'GET',
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
      return payload
    }

    /** 一次 POST JSON；返回 Host 的最新快照。 */
    async function postJson(action, body) {
      const response = await fetch(`${API}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body === undefined ? {} : body),
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
      return payload
    }

    /** 上传一个文件：请求体就是字节，文件名放在头里（URI 编码）。 */
    async function postFile(file, slot) {
      const response = await fetch(`${API}/upload?slot=${slot === 'b' ? 'b' : 'pool'}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/octet-stream',
          'x-sfx-name': encodeURIComponent((file && file.name) || 'sound'),
        },
        body: file,
        credentials: 'same-origin',
        cache: 'no-store',
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`)
      return payload
    }

    /** 正在播的音频：留着引用，免得播到一半被回收。 */
    const liveAudios = []

    /** 播一个音效条目；失败就记到 store 里，面板会显示出来。 */
    function playItem(item) {
      if (item === null || typeof item !== 'object' || typeof item.id !== 'string') return
      const name = typeof item.name === 'string' ? item.name : item.id
      try {
        const audio = new Audio(`${API}/audio/${encodeURIComponent(item.id)}`)
        audio.preload = 'auto'
        const drop = () => {
          const at = liveAudios.indexOf(audio)
          if (at >= 0) liveAudios.splice(at, 1)
        }
        audio.addEventListener('ended', drop)
        audio.addEventListener('error', () => {
          store.lastError = translate('playFailed', { error: name })
          store.emit()
          drop()
        })
        liveAudios.push(audio)
        while (liveAudios.length > 6) {
          const old = liveAudios.shift()
          try {
            old.pause()
          } catch {
            /* 已经停了 */
          }
        }
        const started = audio.play()
        if (started && typeof started.catch === 'function') {
          started.catch((error) => {
            store.lastError = translate('playFailed', { error: describe(error) })
            store.emit()
            drop()
          })
        }
      } catch (error) {
        store.lastError = translate('playFailed', { error: describe(error) })
        store.emit()
      }
    }

    /** 从 A 池随机播一个；池子是空的那就不响。 */
    function playRandomFromPool() {
      const state = store.state
      if (state === null || !Array.isArray(state.pool) || state.pool.length === 0) return false
      playItem(state.pool[Math.floor(Math.random() * state.pool.length)])
      return true
    }

    /**
     * 常驻播放引擎。
     *
     * 每秒问 Host 一次「上次序号之后发生了什么」：
     *   - `task-end`：随机播一个 A 池音效，并按 Host 给的 deadline 起倒计时；
     *   - `activity`：用户有新消息/新任务/新对话，倒计时立刻作废；
     *   - `state`：开关或音效列表变了，重新拉一次快照。
     * 倒计时到点播一次 B，然后不再重排 —— 同一次任务只响一次。
     */
    function startEngine() {
      let disposed = false
      let lastSeq = null
      let pollTimer = null
      let remindTimer = null

      const clearReminder = () => {
        if (remindTimer !== null) {
          clearTimeout(remindTimer)
          remindTimer = null
        }
        if (store.pending !== null) {
          store.pending = null
          store.emit()
        }
      }

      const armReminder = (deadline) => {
        clearReminder()
        if (deadline === null || deadline === undefined) return
        const at = Number(deadline)
        if (!Number.isFinite(at)) return
        const delay = Math.max(0, at - Date.now())
        store.pending = { deadline: at }
        store.emit()
        remindTimer = setTimeout(() => {
          remindTimer = null
          const armed = store.pending
          store.pending = null
          store.emit()
          // 一次任务只响一次：这里放完就结束，不会再排下一次。
          if (disposed || armed === null) return
          const state = store.state
          if (state === null || !state.enabledB) return
          if (state.reminder) playItem(state.reminder)
        }, delay)
      }

      const refresh = async (syncSeq) => {
        const payload = await getJson('state')
        if (disposed) return payload
        store.state = payload
        if (syncSeq === true && payload !== null && typeof payload.seq === 'number') lastSeq = payload.seq
        store.emit()
        return payload
      }

      /** 启动（或刷新后）把还没到点的倒计时接上：刷新页面不该丢掉正在走的提醒。 */
      const resume = async () => {
        const payload = await refresh(true)
        if (disposed || payload === null || typeof payload !== 'object') return
        const pending = payload.pending
        const viable =
          Boolean(payload.enabledB) &&
          typeof payload.reminder === 'object' &&
          payload.reminder !== null &&
          pending !== null &&
          typeof pending === 'object' &&
          !pending.expired &&
          Number(pending.deadline) > Date.now()
        if (viable) armReminder(pending.deadline)
        else clearReminder()
      }

      const handle = (event) => {
        if (event === null || typeof event !== 'object') return
        if (event.type === 'task-end') {
          if (store.state === null) return
          // 两路各看各的开关：A 只决定「响不响完成音效」，B 只决定「起不起倒计时」。
          if (store.state.enabledA) playRandomFromPool()
          if (store.state.enabledB) armReminder(event.data && event.data.deadline)
          else clearReminder()
          return
        }
        if (event.type === 'activity') {
          clearReminder()
          return
        }
        if (event.type === 'state') {
          // 开关、音效列表、提醒时长都可能变了：重新对一次快照，并跟着 Host 的新 deadline 重新对时。
          refresh(false)
            .then((payload) => {
              if (disposed || payload === null || typeof payload !== 'object') return
              const next = payload.pending
              const live =
                next !== null &&
                typeof next === 'object' &&
                payload.enabledB === true &&
                next.expired !== true &&
                Number(next.deadline) > Date.now()
              if (live) armReminder(next.deadline)
              else clearReminder()
            })
            .catch(() => {})
          return
        }
      }

      const poll = async () => {
        if (disposed) return
        try {
          if (lastSeq === null) await resume()
          const response = await fetch(`${API}/events?since=${lastSeq === null ? 0 : lastSeq}`, {
            method: 'GET',
            credentials: 'same-origin',
            cache: 'no-store',
          })
          if (response.ok) {
            const payload = await response.json().catch(() => null)
            if (disposed) return
            if (payload !== null && payload.reset === true) {
              // 事件滚掉了（或宿主重启过）：丢掉本地倒计时，重新对一次快照。
              clearReminder()
              await resume()
            } else if (payload !== null) {
              const list = Array.isArray(payload.events) ? payload.events : []
              for (const event of list) handle(event)
              if (typeof payload.seq === 'number') lastSeq = payload.seq
            }
          }
        } catch {
          /* 宿主还没起来、路由暂时不可用：静默重试，不打扰用户 */
        } finally {
          if (!disposed) pollTimer = setTimeout(poll, POLL_MS)
        }
      }

      resume().catch(() => {})
      pollTimer = setTimeout(poll, POLL_MS)

      return () => {
        disposed = true
        if (pollTimer !== null) clearTimeout(pollTimer)
        if (remindTimer !== null) clearTimeout(remindTimer)
        pollTimer = null
        remindTimer = null
        lastSeq = null
        store.pending = null
        for (const audio of liveAudios.splice(0, liveAudios.length)) {
          try {
            audio.pause()
          } catch {
            /* 已经停了 */
          }
        }
      }
    }

    /** 侧边栏图标：一个喇叭加两道声波，颜色跟随按钮的 currentColor。 */
    function Icon({ size, active }) {
      const px = typeof size === 'number' && size > 0 ? size : 20
      return h(
        'svg',
        {
          width: px,
          height: px,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: active ? 1.9 : 1.7,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': true,
          focusable: false,
        },
        h('path', { key: 'body', d: 'M4 9.6h3.1L11.9 5.4v13.2L7.1 14.4H4z' }),
        h('path', { key: 'w1', d: 'M15.3 9.2a3.9 3.9 0 0 1 0 5.6' }),
        h('path', { key: 'w2', d: 'M18 6.5a7.7 7.7 0 0 1 0 11' }),
      )
    }

    const S = {
      page: {
        height: '100%',
        width: '100%',
        minHeight: 0,
        overflowY: 'auto',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
        boxSizing: 'border-box',
      },
      inner: {
        maxWidth: '880px',
        margin: '0 auto',
        padding: '26px 28px 40px',
        display: 'flex',
        flexDirection: 'column',
        gap: '14px',
        boxSizing: 'border-box',
      },
      head: {
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: '16px',
      },
      title: {
        margin: 0,
        fontSize: '19px',
        fontWeight: 600,
        lineHeight: 1.3,
        letterSpacing: '0.01em',
      },
      intro: {
        margin: '6px 0 0',
        fontSize: '13px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
        maxWidth: '640px',
      },
      gates: {
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '12px 14px',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1, #e4e6eb)',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
      },
      gate: { display: 'flex', flexDirection: 'column', gap: '2px' },
      gateRow: { display: 'flex', alignItems: 'center', gap: '10px' },
      gateName: {
        flex: '1 1 auto',
        minWidth: 0,
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
      },
      gateHint: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      strip: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 14px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l1, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fbfbfc)',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      dot: {
        width: '8px',
        height: '8px',
        flex: '0 0 auto',
        borderRadius: '50%',
        background: 'var(--dsw-alias-state-idle-primary, #b6bac2)',
      },
      stripText: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' },
      stripHint: {
        marginLeft: 'auto',
        flex: '0 0 auto',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      card: {
        display: 'flex',
        flexDirection: 'column',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1, #e4e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fbfbfc)',
        overflow: 'hidden',
      },
      cardHead: {
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '14px 16px 12px',
        borderBottom: '1px solid var(--dsw-alias-border-l1, #e4e6eb)',
      },
      cardTitle: {
        margin: 0,
        fontSize: '14px',
        fontWeight: 600,
        lineHeight: 1.4,
      },
      cardHint: {
        margin: '4px 0 0',
        fontSize: '12px',
        lineHeight: 1.55,
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      cardBody: {
        display: 'flex',
        flexDirection: 'column',
        padding: '6px 8px',
      },
      row: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '8px 8px',
        borderRadius: '8px',
        fontSize: '13px',
        lineHeight: 1.4,
      },
      rowIndex: {
        flex: '0 0 auto',
        width: '20px',
        textAlign: 'right',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      rowName: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      },
      rowSize: {
        flex: '0 0 auto',
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      empty: {
        margin: '4px 8px 8px',
        padding: '18px 16px',
        borderRadius: '9px',
        border: '1px dashed var(--dsw-alias-border-l2, #c9ccd4)',
        fontSize: '13px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
        textAlign: 'center',
      },
      delayRow: {
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '8px',
        margin: '2px 8px 6px',
        padding: '10px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1, #e4e6eb)',
        background: 'var(--dsw-alias-bg-base, #ffffff)',
      },
      delayLabel: {
        flex: '1 1 120px',
        minWidth: 0,
        fontSize: '13px',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
      },
      delayCtl: {
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        flex: '0 0 auto',
      },
      delayInput: {
        width: '68px',
        padding: '4px 8px',
        border: '1px solid var(--dsw-alias-border-l2, #c9ccd4)',
        borderRadius: '7px',
        background: 'transparent',
        color: 'inherit',
        font: 'inherit',
        fontSize: '13px',
        lineHeight: 1.5,
      },
      delayUnit: {
        fontSize: '12px',
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      preset: {
        padding: '3px 8px',
        border: '1px solid var(--dsw-alias-border-l2, #c9ccd4)',
        borderRadius: '999px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        cursor: 'pointer',
      },
      presetOn: {
        borderColor: 'var(--dsw-alias-state-warn-primary, #d99426)',
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
        fontWeight: 600,
        cursor: 'default',
      },
      importButton: {
        flex: '0 0 auto',
        marginLeft: 'auto',
        padding: '6px 14px',
        border: '1px solid var(--dsw-alias-border-l2, #c9ccd4)',
        borderRadius: '8px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
        font: 'inherit',
        fontSize: '12px',
        fontWeight: 600,
        lineHeight: 1.4,
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      },
      ghost: {
        flex: '0 0 auto',
        padding: '4px 10px',
        border: '1px solid var(--dsw-alias-border-l2, #c9ccd4)',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary, #1b1c1f)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        cursor: 'pointer',
      },
      danger: {
        flex: '0 0 auto',
        padding: '4px 10px',
        border: '1px solid var(--dsw-alias-border-l2, #c9ccd4)',
        borderRadius: '7px',
        background: 'transparent',
        color: 'var(--dsw-alias-state-error-primary, #d64545)',
        font: 'inherit',
        fontSize: '12px',
        lineHeight: 1.5,
        cursor: 'pointer',
      },
      foot: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-label-secondary, #5f626b)',
      },
      error: {
        margin: 0,
        fontSize: '12px',
        lineHeight: 1.6,
        color: 'var(--dsw-alias-state-error-primary, #d64545)',
      },
    }

    /** 开关：role=switch 的按钮，读屏器读得懂；轨道与滑块都用纯内联样式。 */
    function Switch({ on, busy, hint, onToggle, label }) {
      const stateText = on ? translate('toggleOn') : translate('toggleOff')
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': on,
          'aria-label': label === undefined ? stateText : `${label} ${stateText}`,
          'aria-busy': busy ? true : undefined,
          disabled: busy,
          onClick: onToggle,
          title: hint,
          style: {
            display: 'inline-flex',
            alignItems: 'center',
            gap: '9px',
            flex: '0 0 auto',
            padding: '5px 8px',
            margin: 0,
            background: 'transparent',
            border: 0,
            borderRadius: '999px',
            cursor: busy ? 'default' : 'pointer',
            color: 'var(--dsw-alias-label-primary, #1b1c1f)',
            font: 'inherit',
            fontSize: '13px',
            lineHeight: 1,
            opacity: busy ? 0.7 : 1,
          },
        },
        h(
          'span',
          {
            key: 'track',
            style: {
              position: 'relative',
              display: 'inline-block',
              width: '36px',
              height: '20px',
              flex: '0 0 auto',
              borderRadius: '999px',
              background: on
                ? 'var(--dsw-alias-brand-primary, #4c6ef5)'
                : 'var(--dsw-alias-border-l2, #c9ccd4)',
              transition: 'background 160ms ease',
            },
          },
          h('span', {
            style: {
              position: 'absolute',
              top: '2px',
              left: on ? '18px' : '2px',
              width: '16px',
              height: '16px',
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.28)',
              transition: 'left 160ms ease',
            },
          }),
        ),
        h('span', { key: 'text' }, stateText),
      )
    }

    /** 一条音效：序号、文件名、大小、试听、删除。 */
    function SoundRow({ item, index, busy, onPreview, onRemove }) {
      return h(
        'div',
        { style: S.row },
        h('span', { style: S.rowIndex }, String(index + 1)),
        h('span', { style: S.rowName, title: item.name }, item.name),
        h('span', { style: S.rowSize }, formatSize(item.size)),
        h(
          'button',
          {
            type: 'button',
            style: S.ghost,
            disabled: busy,
            title: translate('preview'),
            onClick: () => onPreview(item),
          },
          translate('preview'),
        ),
        h(
          'button',
          {
            type: 'button',
            style: S.danger,
            disabled: busy,
            title: translate('remove'),
            onClick: () => onRemove(item),
          },
          translate('remove'),
        ),
      )
    }

    /** 上传入口：一个看不见的 file input 套在 label 里，点文字就弹选择框。 */
    function ImportButton({ slot, multiple, busy, onPick }) {
      return h(
        'label',
        {
          style: { ...S.importButton, opacity: busy ? 0.6 : 1, cursor: busy ? 'default' : 'pointer' },
          title: slot === 'b' ? translate('reminderImport') : translate('poolImport'),
        },
        h('input', {
          type: 'file',
          accept: 'audio/*',
          multiple: multiple === true,
          disabled: busy,
          style: { display: 'none' },
          onChange: (event) => {
            const input = event.target
            const files = Array.prototype.slice.call((input && input.files) || [])
            // 同一个文件连选两次也要能再次触发 change，所以顺手清空。
            if (input) input.value = ''
            if (files.length > 0 && typeof onPick === 'function') onPick(files, slot)
          },
        }),
        slot === 'b' ? translate('reminderImport') : translate('poolImport'),
      )
    }

    /** 面板本体：开关、A 池、B 池、倒计时。 */
    function Panel() {
      useLocaleRevision()
      const state = useStore()
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const [phase, setPhase] = React.useState('loading')
      // 提醒间隔输入框里还没提交的草稿；null 表示「显示 Host 的值」。
      const [draft, setDraft] = React.useState(null)

      const snapshot = state.state
      const pending = state.pending
      useTick(pending !== null)

      React.useEffect(() => {
        let alive = true
        getJson('state')
          .then((payload) => {
            if (!alive) return
            state.state = payload
            state.emit()
            setPhase('ready')
          })
          .catch((error) => {
            if (!alive) return
            setPhase('failed')
            setNote({ kind: 'error', text: translate('loadFailed', { error: describe(error) }) })
          })
        return () => {
          alive = false
        }
      }, [])

      const seconds =
        snapshot !== null && snapshot !== undefined && Number.isFinite(snapshot.reminderSeconds)
          ? snapshot.reminderSeconds
          : 300
      const enabledA = snapshot !== null && snapshot !== undefined ? Boolean(snapshot.enabledA) : false
      const enabledB = snapshot !== null && snapshot !== undefined ? Boolean(snapshot.enabledB) : false
      const pool = snapshot !== null && snapshot !== undefined && Array.isArray(snapshot.pool) ? snapshot.pool : []
      const reminder = snapshot !== null && snapshot !== undefined ? snapshot.reminder : null
      const interactive = !busy && phase !== 'loading'

      const adopt = (payload) => {
        if (payload !== null && typeof payload === 'object') {
          state.state = payload
          state.emit()
        }
      }

      // slot: 'a' 完成音效，'b' 提醒音效 —— 两个开关互不牵连。
      const toggle = async (slot) => {
        if (!interactive) return
        setBusy(true)
        setNote(null)
        try {
          adopt(await postJson('toggle', { slot, enabled: slot === 'b' ? !enabledB : !enabledA }))
        } catch (error) {
          setNote({ kind: 'error', text: translate('saveFailed', { error: describe(error) }) })
        } finally {
          setBusy(false)
        }
      }

      const upload = async (files, slot) => {
        if (files.length === 0) return
        setBusy(true)
        setNote(null)
        try {
          for (const file of files) {
            adopt(await postFile(file, slot))
          }
        } catch (error) {
          setNote({ kind: 'error', text: translate('uploadFailed', { error: describe(error) }) })
        } finally {
          setBusy(false)
        }
      }

      const remove = async (item, slot) => {
        if (!interactive) return
        setBusy(true)
        setNote(null)
        try {
          adopt(await postJson('delete', { slot, id: item.id }))
        } catch (error) {
          setNote({ kind: 'error', text: translate('removeFailed', { error: describe(error) }) })
        } finally {
          setBusy(false)
        }
      }

      const preview = (item) => {
        state.lastError = null
        playItem(item)
      }

      const secondsMin =
        snapshot !== null && snapshot !== undefined && Number.isFinite(snapshot.secondsMin) ? snapshot.secondsMin : 1
      const secondsMax =
        snapshot !== null && snapshot !== undefined && Number.isFinite(snapshot.secondsMax) ? snapshot.secondsMax : 43200
      const delayText = draft === null ? String(seconds) : draft

      /** 把输入框里的秒数交给 Host；Host 负责夹取与落盘，回来的是最新快照。 */
      const commitSeconds = async (value) => {
        const raw = Number(value)
        if (!Number.isFinite(raw) || raw <= 0) {
          setDraft(null)
          setNote({ kind: 'error', text: translate('delayInvalid', { lo: secondsMin, hi: secondsMax }) })
          return
        }
        const target = Math.round(Math.min(secondsMax, Math.max(secondsMin, raw)))
        setBusy(true)
        setNote(null)
        try {
          adopt(await postJson('seconds', { seconds: target }))
          setDraft(null)
        } catch (error) {
          setNote({ kind: 'error', text: translate('saveFailed', { error: describe(error) }) })
        } finally {
          setBusy(false)
        }
      }

      // B 卡顶部那一行：提醒间隔（秒）+ 几个常用预设。
      const delayRow = h(
        'div',
        { style: S.delayRow },
        h(
          'span',
          {
            style: S.delayLabel,
            title: translate('delayRangeHint', { lo: secondsMin, hi: secondsMax }),
          },
          translate('delayLabel'),
        ),
        h(
          'span',
          { style: S.delayCtl },
          h('input', {
            type: 'number',
            inputMode: 'numeric',
            // step=1：秒是整数，浏览器箭头也按 1 递增。
            step: 1,
            min: secondsMin,
            max: secondsMax,
            value: delayText,
            disabled: phase === 'loading',
            'aria-label': translate('delayLabel'),
            title: translate('delayRangeHint', { lo: secondsMin, hi: secondsMax }),
            onChange: (event) => setDraft(event.target.value),
            // 离开输入框就保存；回车等同于离开，省一次多余的提交。
            onBlur: () => {
              if (draft === null) return
              // 只是把内容删空：当作放弃修改，悄悄退回原值，不报错。
              if (String(draft).trim() === '') {
                setDraft(null)
                return
              }
              commitSeconds(draft)
            },
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
            },
            style: S.delayInput,
          }),
          h('span', { style: S.delayUnit }, translate('delayUnit')),
        ),
        h(
          'span',
          { style: S.delayCtl },
          DELAY_PRESETS.map((value) =>
            h(
              'button',
              {
                key: value,
                type: 'button',
                disabled: busy || phase === 'loading',
                onClick: () => {
                  if (value === seconds) return
                  commitSeconds(value)
                },
                style: value === seconds ? { ...S.preset, ...S.presetOn } : S.preset,
              },
              formatDuration(value),
            ),
          ),
        ),
      )

      const remaining = pending !== null ? Math.max(0, pending.deadline - Date.now()) : null
      const armed = pending !== null && enabledB

      const statusText = busy
        ? translate('uploading')
        : armed
          ? translate('countdown', { time: formatClock(remaining) })
          : enabledA || enabledB
            ? translate('idleHint')
            : translate('idleSilent')
      const statusDot = armed
        ? 'var(--dsw-alias-state-warn-primary, #d99426)'
        : 'var(--dsw-alias-state-idle-primary, #b6bac2)'

      const notes = []
      if (note !== null) notes.push(h('p', { style: S.error, key: 'note' }, note.text))
      if (state.lastError !== null) notes.push(h('p', { style: S.error, key: 'play' }, state.lastError))

      const gate = (slot, on, labelKey, hintOnKey, hintOffKey) => {
        const hint = translate(on ? hintOnKey : hintOffKey, { sec: formatDuration(seconds) })
        return h(
          'div',
          { style: S.gate, key: slot },
          h(
            'div',
            { style: S.gateRow },
            h('span', { style: S.gateName }, translate(labelKey)),
            h(Switch, {
              on,
              busy: busy || phase === 'loading',
              hint,
              label: translate(labelKey),
              onToggle: () => toggle(slot),
            }),
          ),
          h('p', { style: S.gateHint }, hint),
        )
      }

      const body = []
      // 头部：标题 + 两个互不牵连的开关
      body.push(
        h(
          'div',
          { style: S.head, key: 'head' },
          h('div', { style: { minWidth: 0 } }, h('h1', { style: S.title }, translate('title')), h('p', { style: S.intro }, translate('intro'))),
        ),
      )
      body.push(
        h(
          'div',
          { style: S.gates, key: 'gates' },
          gate('a', enabledA, 'switchA', 'switchAHintOn', 'switchAHintOff'),
          gate('b', enabledB, 'switchB', 'switchBHintOn', 'switchBHintOff'),
        ),
      )
      // 状态条：倒计时 / 说明
      body.push(
        h(
          'div',
          { style: S.strip, key: 'strip' },
          h('span', { style: { ...S.dot, background: statusDot } }),
          h('span', { style: S.stripText }, phase === 'loading' ? translate('loading') : statusText),
          armed ? h('span', { style: S.stripHint }, translate('countdownHint')) : null,
        ),
      )
      // A 池
      body.push(
        h(
          'section',
          { style: S.card, key: 'pool' },
          h(
            'div',
            { style: S.cardHead },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('h2', { style: S.cardTitle }, translate('poolTitle')),
              h('p', { style: S.cardHint }, translate('poolHint')),
            ),
            h(ImportButton, { slot: 'pool', multiple: true, busy: !interactive, onPick: upload }),
          ),
          h(
            'div',
            { style: S.cardBody },
            pool.length === 0
              ? h('div', { style: S.empty }, translate('poolEmpty'))
              : pool.map((item, index) =>
                  h(SoundRow, {
                    key: item.id,
                    item,
                    index,
                    busy: !interactive,
                    onPreview: preview,
                    onRemove: (target) => remove(target, 'pool'),
                  }),
                ),
          ),
        ),
      )
      // B 池
      body.push(
        h(
          'section',
          { style: S.card, key: 'reminder' },
          h(
            'div',
            { style: S.cardHead },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('h2', { style: S.cardTitle }, translate('reminderTitle')),
              h('p', { style: S.cardHint }, translate('reminderHint', { sec: formatDuration(seconds) })),
            ),
            h(ImportButton, { slot: 'b', multiple: false, busy: !interactive, onPick: upload }),
          ),
          h(
            'div',
            { style: S.cardBody },
            delayRow,
            reminder === null || reminder === undefined
              ? h('div', { style: S.empty }, translate('reminderEmpty'))
              : h(SoundRow, {
                  item: reminder,
                  index: 0,
                  busy: !interactive,
                  onPreview: preview,
                  onRemove: (target) => remove(target, 'b'),
                }),
          ),
        ),
      )
      if (notes.length > 0) body.push(h('div', { key: 'notes', style: { display: 'flex', flexDirection: 'column', gap: '4px' } }, notes))
      body.push(h('p', { style: S.foot, key: 'foot' }, translate('stored')))

      return h('div', { style: S.page }, h('div', { style: S.inner }, body))
    }

    return {
      name: 'dsh-task-sfx',
      inject: ['slots', 'locale'],
      apply(ctx) {
        if (ctx !== null && ctx !== undefined && ctx.locale) localeService = ctx.locale

        // 词典：把声明过的语言都注册一份（中英以外的语言退回英文），界面语言一换文案就跟着换。
        ctx.effect(() => {
          const disposers = []
          const ids = new Set(['en', 'zh'])
          try {
            const snapshot = ctx.locale.getSnapshot()
            if (snapshot && Array.isArray(snapshot.locales)) {
              for (const definition of snapshot.locales) {
                if (definition && typeof definition.id === 'string') ids.add(definition.id)
              }
            }
          } catch {
            /* 拿不到语言目录就只注册中英 */
          }
          for (const id of ids) {
            const table = /^zh/i.test(id) ? COPY.zh : COPY.en
            try {
              disposers.push(ctx.locale.register(NS, id, table))
            } catch {
              /* 同语言重复注册（插件被加载两次）不该让整个插件挂掉 */
            }
          }
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                /* 已经释放 */
              }
            }
          }
        }, 'task-sfx: dictionaries')

        // 常驻播放引擎：面板关着也照常工作。
        ctx.effect(() => startEngine(), 'task-sfx: audio engine')

        // 侧边栏一个图标项（图标由外壳包成按钮，点击后主区域切到同名 main 面板）。
        ctx.slots.inject('sidebar.panellist', () =>
          ctx.slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: 30, label: () => translate('label') },
            Icon,
          ),
        )

        // 主区域面板，key 与上面的 id 相同。
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, Panel))
      },
    }
  },
})
