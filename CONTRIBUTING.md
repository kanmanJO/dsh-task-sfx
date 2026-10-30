# 参与贡献

这个插件很小：Host 半 `index.js` 负责会话事件、倒计时与 HTTP 接口，Client 半 `client.js` 负责侧边栏入口、设置面板和播放引擎。没有构建步骤，也不需要安装依赖。

## 先跑一遍

```bash
node --version     # 需要 ^22.19.0 || >=24.0.0
npm run check      # 两个入口文件的语法
npm test           # 18 项冒烟测试，纯 Node，不需要 DSH
```

`npm test` 会在临时目录里起一个真 http 服务器打插件自己的路由，**不会碰你的 `~/.dsh`**。

## 本地联调

1. 把仓库目录直接装进 profile：`plugin_manager → install_bundle → target = <本目录绝对路径>`（装出来是符号链接，改源码即可生效）。
2. 改了 Host 半要重载：`plugin_manager → set_bundle → 先 enabled=false 再 enabled=true`。
3. 改了 Client 半：浏览器 `F5`。
4. 面板打不开时先看浏览器控制台，slot 内部抛错会把整块面板刷白（`slot entry crashed in '...'`）。

## 代码约定

- **只用 Node 内置模块与浏览器全局**，不引入第三方运行时依赖。
- 文件名、文案、颜色的来源都在 `client.js` 顶部：文案进 `COPY.en` / `COPY.zh` 两张表，**任何界面上能看到的字都不要硬编码**；颜色只用 `--dsw-alias-*` token，别写死十六进制。
- Client 半只做三件事：注册 slot、渲染面板、订阅自己 Host 的接口。**不要 require 其它 Harness 的 Client 包，不要用 iframe 托管页面。**
- Host 半的所有副作用都挂在 `ctx.effect` / `ctx.on` 的 dispose 上，别留没人回收的定时器或监听。
- 数据落盘只在 `<DSH home>/task-sfx/` 里；写文件用「临时文件 + rename」的原子写法。
- 界面文案中英都要给（`COPY.en` / `COPY.zh`），改一处记得改另一处。

## 提 PR

1. `npm run check && npm test` 必须全绿。
2. 行为有变化就更新 `CHANGELOG.md`；对使用者可见的行为变化同时更新 `README.md`。
3. 说明「为什么」而不只是「改了什么」——尤其是判定逻辑（什么算任务完成、什么时候作废倒计时）的调整。
4. 一个 PR 只做一件事，别把重构和功能混在一起。

## 行为准则

对人友好，对事较真：评论针对代码与设计，不针对人；不提交别人的私有音频、不塞来源不明的素材（仓库里的 `icon.svg` 是自己画的）。
