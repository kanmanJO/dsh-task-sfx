# 任务完成音效与提醒 · dsh-task-sfx

[DeepSeek Harness](https://github.com/deepseek-ai)（DSH）插件：给会话装两套**互不相干**的音效。

![CI](https://github.com/kanmanJO/dsh-task-sfx/actions/workflows/ci.yml/badge.svg)
![license](https://img.shields.io/badge/license-MIT-green.svg)
![node](https://img.shields.io/badge/node-%5E22.19.0%20%7C%7C%20%3E%3D24.0.0-brightgreen.svg)
![dependencies](https://img.shields.io/badge/dependencies-0-blue.svg)

1. **任务完成音效（A 池）** —— 每次回复结束，从你导入的音效里随机播一个，同时开始一个倒计时。
2. **提醒音效（B）** —— 倒计时走到头、且这段时间里你没有任何新消息 / 新任务 / 新对话，才补响一次提醒；同一次任务只响一次，响完不再重新倒计时。

English: a random chime every time a reply finishes, plus a one-shot reminder if you stay quiet for a configurable number of seconds afterwards. Two independent switches; everything persists under `<DSH home>/task-sfx/`.

## 特性

- **两个独立开关**：只想听完成音效就关 B；只想被提醒就关 A。**B 关着时连倒计时都不会开始**。
- **A 池批量导入**：一次选多个本地音频，列表里逐条试听 / 删除。
- **B 单独上传**：只放一个文件，换掉旧的即替换（旧文件同时删掉）。
- **间隔按秒可调**：1–43200 秒，带 `10s / 30s / 1m / 5m / 10m` 一键预设；改完立刻生效，正在走的倒计时按新时长重算。
- **随便打断**：发消息、开新对话、起新任务都会立刻作废倒计时。
- **重启不丢**：开关、音效、间隔都存在磁盘上。
- **不打扰子任务**：子代理自己的回合不算「任务完成」，不会乱响。
- 中英双语界面，跟随 DSH 当前语言。

## 安装

本包是标准 DSH bundle：`package.json` 里带 `dsh.bundle.patch` 与 `dsh.client`，**没有构建步骤、没有依赖**。

方式一，从 npm（`npm publish` 之后）：

```
plugin_manager → install_bundle → target = dsh-task-sfx
```

方式二，从本仓库：

```bash
git clone https://github.com/kanmanJO/dsh-task-sfx.git
```

然后把克隆下来的目录装进去：

```
plugin_manager → install_bundle → target = <克隆下来的目录绝对路径>
```

装好后左侧边栏出现喇叭图标（与「插件」「自动化任务」同级）。**改了源码需要重载插件，并在浏览器按 F5。**

## 怎么用

1. 点左侧喇叭图标打开面板。
2. 打开 `任务完成音效（A）` 与 `提醒音效（B）` 两个开关。
3. `批量导入音频` 一次选多个文件放进 A 池；`选择提醒音效` 单独挑一个给 B。
4. 在 B 卡片顶部填间隔秒数（回车或失焦即保存），也可以直接点预设。
5. 正常聊天即可：每轮回复结束响 A；安静到倒计时走完再响一次 B。

> 浏览器不允许页面在没有用户交互的情况下自动出声。首次使用请先在面板里点一次「试听」，之后的声音才会自动播放。

## 数据放在哪

```
<DSH home>/task-sfx/
├── config.json     # 两个开关、间隔（秒）、音效清单（原子写入）
└── sounds/         # 导入的音频，文件名即条目 id
```

`<DSH home>` 默认是 `C:\Users\<你>\.dsh`（可用 `DSH_HOME` 覆盖）。音频与插件代码分开放，卸载、升级插件都不会丢。

## 支持的格式

mp3、m4a、m4b、mp4、aac、wav、wave、ogg、oga、opus、flac、webm、weba、aif、aiff、caf、wma。单个文件上限 40 MB，A 池最多 200 个。

## 工作方式

- **Host 半**（`index.js`）：订阅会话的 `turn/end`、`user/message`、`turn/start` 与 `session/created`，只在根会话上算数（`aborted` 不算完成）；同时注册一组同源 HTTP 路由供面板读写状态、上传/删除音频、取音频字节、轮询事件。音频与状态文件都在 Host 进程里落盘。
- **Client 半**（`client.js`）：向 `sidebar.panellist` 与 `main` 各注册一处，并常驻一台每秒轮询事件的播放引擎——收到 `task-end` 就随机播 A 并按 deadline 起倒计时，收到 `activity` 就清掉倒计时，收到 `state` 就按最新 deadline 重新对时。引擎跟着插件加载，面板关着也照常工作。

用轮询而不是 SSE：宿主换实现、反向代理、页面重连都不会把推送悄悄断掉，而这里要的只是「一秒内到达」。

### HTTP 接口

全部挂在 `/task-sfx/api` 下，同源访问：

| 方法与路径 | 作用 |
| --- | --- |
| `GET /state` | 当前快照：`enabledA`、`enabledB`、`reminderSeconds`、`secondsMin`、`secondsMax`、`pool`、`reminder`、`pending`、`seq` |
| `GET /events?since=N` | 拉取 N 之后的事件（`task-end` / `activity` / `state`），缓冲区滚掉时回 `reset` |
| `POST /toggle` | `{ slot: "a" \| "b", enabled?: boolean }`，省略 `enabled` 取反 |
| `POST /seconds` | `{ seconds: number }`，夹到 1–43200 并取整 |
| `POST /upload` | 裸字节上传，文件名放在 `x-sfx-name` 头，`?slot=pool\|b` |
| `POST /delete` | `{ slot: "pool" \| "b", id?: string }` |
| `GET /audio/<id>` | 音频字节，支持单段 Range |

## 配置

提醒间隔的唯一真相是 `config.json` 里的 `seconds`，面板改的就是它。

两个开关对应 `enabledA` / `enabledB`。旧版本存过单个 `enabled` 与浮点 `minutes`，读到时会分别迁移成「两个都跟着它」和「秒」，升级不丢设置。

`cordis.patch.yml` 里的 `config` 留空即可；想给「从没在面板里设过」的机器一个不同初值时才写：

```yaml
- insert:
    - id: dsh-task-sfx
      name: dsh-task-sfx
      config:
        reminderSeconds: 600
```

（老键 `reminderMinutes` 也认，按分钟换算。）

## 开发

```bash
npm run check       # node --check 两个入口文件
npm test            # 18 项冒烟测试，纯 Node，不需要 DSH
npm run repo -- <github-username>   # 把 package.json 与本文里占位的仓库地址换成你的
npm pack --dry-run  # 打包内容自检
```

`npm test` 会在临时目录里起一个真 http 服务器打插件自己的路由，**不会碰真实的 `~/.dsh`**。

插件在 profile 里是符号链接（junction），改源码后：`plugin_manager set_bundle` 先 `enabled=false` 再 `enabled=true` 重载 Host 半，浏览器 F5 重载 Client 半。

### 目录结构

```
dsh-task-sfx/
├── index.js              # Host 半：事件、倒计时、HTTP 路由、落盘
├── client.js             # Client 半：侧边栏入口、设置面板、播放引擎
├── cordis.patch.yml      # bundle 安装补丁
├── locale/{en,zh}.json   # 插件清单里的显示名与简介
├── icon.svg              # 侧边栏图标（自绘）
├── test/smoke.mjs        # 冒烟测试
├── scripts/set-repo.mjs  # 仓库地址一键替换
└── .github/              # CI、issue 与 PR 模板
```

## 贡献

欢迎 PR。动手前请读 [CONTRIBUTING.md](./CONTRIBUTING.md)：里面写了本地联调步骤、代码约定（文案表、token、无第三方依赖）和提交前必须跑的命令。

## 许可证

[MIT](./LICENSE) · 图标为自绘原创，可随本项目一并使用。
