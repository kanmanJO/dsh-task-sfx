# Changelog

All notable changes to `dsh-task-sfx` are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- 开源仓库配套：`CONTRIBUTING.md`、GitHub Actions CI（Node 22.19 / 24 两版跑语法检查、冒烟测试、打包自检）、issue 与 PR 模板、`.editorconfig`、`.gitattributes`。
- `test/smoke.mjs`：18 项冒烟测试，用真 http 服务器打插件自己的路由，覆盖开关、秒数夹取、`turn/end` 倒计时、用户动作作废、子代理过滤、上传/回放/Range/删除、B 槽替换、旧配置与 BOM 迁移。
- `scripts/set-repo.mjs`：`npm run repo -- <github-username>` 一键把 `repository` / `homepage` / `bugs` 三个占位字段换成真实地址。

### Fixed

- 上传成功时推送的 `state` 事件还带着已废弃的 `enabled` 字段，改为 `enabledA` / `enabledB`，与其它事件负载保持一致。

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
