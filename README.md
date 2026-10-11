# @local/dsh-git-panel

会话右侧栏的可视化 Git 面板：改动清单、统一 diff 查看器、带泳道的提交图、分支列表，以及暂存 / 取消暂存 / 提交。

这是一个 DSH（DeepSeek Harness）工作区插件包，包含 Host 半（`index.js` + `lib/git.js`）和 Client 半（`client.js`）。

## 安装

```
plugin_manager install_bundle  target = F:\dsh-git
```

安装会把它写进当前 profile（需要批准）。替换已安装包的 JavaScript 之后通常要重启 Harness 才会加载新的一代模块。

## 用法

1. 打开一个会话，右侧栏 `+` → **Git**（工作区不是仓库时会提示）。
2. 或点会话标题栏里的 Git 图标直接打开。

面板分三个页签：

- **改动**：冲突 / 已暂存 / 未暂存 / 未跟踪分组，按目录折叠；工具栏支持全部暂存 / 全部取消暂存；点文件看 diff；行操作按钮常显、hover 增强；底部是提交框（Ctrl/⌘+Enter 提交）。
- **历史**：提交图（按 parents 计算泳道，行与行的连线连续、圆角拐弯）、引用 chip、作者与日期副行，点击进入该提交的详情与补丁。
- **分支**：本地分支 / 远程分支 / 标签，含上游与领先落后。

diff 查看器带行号与 hunk 折叠；单行替换会用 mark 高亮改动的那一两个词。

## 测试

```
pnpm test          # 或：node tools/smoke.mjs && node tools/client-smoke.mjs
```

- `tools/smoke.mjs`：Host 半，对着临时仓库跑 git 参数与解析器（25 项断言）。
- `tools/client-smoke.mjs`：Client 半，用一个微型 React 运行时把面板渲染到桩 Host API 上（55 项断言：分组、目录折叠、diff 行号/词级高亮/hunk 折叠、暂存/提交流程、历史与分支、空态与错误重试）。

## 配置

在 profile 的 bundle 行里给 `@local/dsh-git-panel` 加 `config`：

| 键 | 默认 | 说明 |
| --- | --- | --- |
| `gitPath` | `"git"` | git 可执行文件；交给 `ctx.subprocess.resolveExecutable` 解析 |
| `allowWrite` | `true` | 设为 `false` 后暂存/提交按钮全部禁用，Host 端也会拒绝 |
| `commitNoVerify` | `false` | 提交时是否附加 `--no-verify`（跳过仓库钩子） |
| `timeoutMs` | `20000` | 读命令超时 |
| `writeTimeoutMs` | `120000` | 写命令超时 |
| `maxOutputBytes` | `8388608` | 单次命令收集输出上限 |
| `maxDiffBytes` | `524288` | 单个 diff 上限，也是未跟踪文件的读取上限 |
| `logLimit` | `200` | 提交图默认条数（上限 1000） |

## 边界

- 只提供这三种写操作：`git add --`、`git restore --staged --`、`git commit -m`。**没有**丢弃改动、切换分支、reset、push 等入口，也没有任何自由参数通道。
- 读命令固定为 `rev-parse` / `symbolic-ref` / `status --porcelain=v2` / `diff` / `log` / `show` / `for-each-ref` / `var`。
- 每个请求先过 `connection.requestRejection`；工作区目录必须属于已注册工作区；路径必须是仓库内相对路径且不含 `..`。
- 写操作串行执行，避免争抢 git 的 index 锁。
- 仓库没有配置 `user.name` / `user.email` 时提交按钮禁用并给出提示。

## 实现说明

浏览器只是渲染层，所有 git 调用都在 Host：Client 通过同源 `fetch` 访问 `/git-panel/*`（`status`、`diff`、`log`、`commit`、`branches`、`stage`、`unstage`）。这与 `open-in-app` 的 Host/Client 配对方式一致，避免在纯 JS bundle 里手写 typert 代码生成产物。

样式只用 `--dsw-alias-*` 主题 token，所有文案走 `ctx.locale`，插件的每个注册都由 `ctx.effect` 持有，卸载即回收。
