# Changelog

All notable changes to `dsh-task-sfx` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [1.3.1] — 2026-11-07

### Fixed

- **npm 页面上的面板截图裂图**：README 里的截图用的是相对路径 `docs/screenshot.png`，而 `docs/` 不在发布包的 `files` 白名单里，npm 渲染 README 时根本取不到这张图。现在截图本身打进包里（顺手压到 76 KB），README 改用 npm CDN 的绝对地址 `https://cdn.jsdelivr.net/npm/dsh-task-sfx/docs/screenshot.png`，npm 与 GitHub 两边都能正常显示。

## [1.3.0] — 2026-10-31

### Changed

- **C 的触发条件扩成「要你出面」的两种情况**：除了原有的审批请求（`approval/request`），现在 `ask_user_question`（DSH 停下来向你提问）与 `exit_plan_mode`（让你确认/修改计划）被调用的那一刻也会响 C。两条路统一走 `notifyAttention()`，事件负载多一个 `kind` 字段（`"approval"` / `"choice"`）。
- 面板与 README 的 C 相关文案改为「授权 / 选择」，并说明 C 不会替你回答、也不会改变审批结果。

### Added

- `test/smoke.mjs`：新增 3 项断言（提问工具触发、退出计划模式触发、普通工具不触发），共计 27 项。

## [1.2.1] — 2026-10-31

### Fixed

- **C 池导入落到 A 池**：`postFile()` 里把槽位写成了 `slot === 'b' ? 'b' : 'pool'`，于是 `slot: "c"` 被当成 A 上传。三个槽位现在各走各的（`b` / `c` / `pool`）。

## [1.2.0] — 2026-10-31

### Added

- **授权提醒音效（C）**：新增第三个独立开关与音效池 C。Host 订阅 waterfall 事件 `approval/request`，在 DSH 弹审批请求的那一刻推一条 `approval` 事件；Client 收到后从 C 池随机播一个。监听器包在 `try/catch` 里并原样 `return next()`，不影响审批结果，也不会碰 B 的倒计时。
- C 池支持批量导入、列表展示、试听与删除（`POST /upload?slot=c`、`POST /delete` 的 `slot: "c"`、`GET /state` 里的 `poolC`）。
- 开源仓库配套：`CONTRIBUTING.md`、GitHub Actions CI（Node 22.19 / 24 两版跑语法检查、冒烟测试、打包自检）、issue 与 PR 模板、`.editorconfig`、`.gitattributes`。
- `test/smoke.mjs`：24 项冒烟测试，用真 http 服务器打插件自己的路由，覆盖开关、秒数夹取、`turn/end` 倒计时、用户动作作废、子代理过滤、上传/回放/Range/删除、B 槽替换、C 池与审批触发、旧配置与 BOM 迁移。
- `scripts/set-repo.mjs`：`npm run repo -- <github-username>` 一键把 `repository` / `homepage` / `bugs` 三个占位字段换成真实地址。

### Changed

- `POST /toggle` 的 `slot` 接受 `"a" | "b" | "c"`；非法值的 400 文案改为 `slot must be "a", "b" or "c"`。
- 旧配置里的单个 `enabled` 仍然只迁移到 A 与 B —— C 默认关着，交给用户自己开。

### Fixed

- 上传成功时推送的 `state` 事件还带着已废弃的 `enabled` 字段，改为 `enabledA` / `enabledB` / `enabledC`，与其它事件负载保持一致。

## [1.1.0] — 2026-10-30

### Changed

- 提醒间隔改为**按秒**设置：面板输入 1–43200 的整数秒，`config.json` 存 `seconds`；旧的 `minutes` 字段读到后自动乘 60 迁移。
- 预设按钮改为 `10s / 30s / 1m / 5m / 10m`，按当前语言显示人话时长。
- HTTP 接口 `POST /task-sfx/api/minutes` 换成 `POST /task-sfx/api/seconds`；状态快照字段 `reminderMinutes` 换成 `reminderSeconds`（另含 `secondsMin` / `secondsMax`）。
- 插件配置键 `reminderMinutes` 换成 `reminderSeconds`，旧键仍按分钟识别。

### Fixed

- `config.json` 带 BOM 时 `JSON.parse` 抛错、面板误显示为空池：读取时先剥掉 BOM。

### Added

- 一个总开关拆成两个独立开关：`任务完成音效（A）` 与 `提醒音效（B）`，可任意组合；B 关闭时 Host 端不再建立倒计时。旧的单字段 `enabled` 按「两个都跟着它」迁移。
- 面板 B 卡片内置提醒间隔输入框与一键预设，改完立刻生效，正在走的倒计时按新时长重算。

## [1.0.0] — 2026-10-30

### Added

- 首次发布：回复结束从 A 池随机播放完成音效，并启动一次性静默提醒倒计时。
- 左侧边栏入口 + 主区设置面板：音效池 A 支持批量导入、逐条试听/删除；音效 B 单独上传。
- Host 半（`index.js`）：自建同源 HTTP 路由（状态、开关、上传、删除、音频字节、事件轮询），订阅 `session/event` 与 `session/created` 判定任务完成与作废倒计时，忽略子代理会话。
- Client 半（`client.js`）：`sidebar.panellist` + `main` 槽位，常驻每秒轮询的播放引擎，面板关闭时也照常工作。
- 音频与开关持久化在 `<DSH home>/task-sfx/`，重启不丢。
