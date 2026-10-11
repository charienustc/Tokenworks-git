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

- **改动**：冲突 / 已暂存 / 未暂存 / 未跟踪分组，按目录折叠；工具栏支持全部暂存 / 全部取消暂存 / 全部放弃；点文件看 diff；行上可暂存、取消暂存、放弃；底部是提交框（Ctrl/⌘+Enter 提交）。
- **历史**：提交图（按 parents 计算泳道，行与行的连线连续、圆角拐弯）、引用 chip、作者与日期副行；工具栏有获取 / 拉取 / 推送与"全部引用"；点进提交详情可拣选、还原、检出、软重置、混合重置。
- **分支**：本地分支 / 远程分支 / 标签 / 远程仓库四个分组；可新建分支（并切换）、新建标签、切换、合并、安全删除。

diff 查看器带行号与 hunk 折叠；单行替换会用 mark 高亮改动的那一两个词。

## 写操作

全部写操作都需要 `allowWrite: true`，并在 Host 端串行执行：

| 操作 | git 命令 |
| --- | --- |
| 暂存 / 取消暂存 | `add --` / `restore --staged --`（无 HEAD 时回退 `rm --cached`） |
| 提交 | `commit -m` |
| 放弃改动 | `restore --worktree --`（仅已跟踪文件） |
| 新建并切换分支 | `switch -c <name> [<start>]` |
| 切换分支 / 检出提交 | `switch <branch>` / `switch --detach <rev>` |
| 删除分支 | `branch -d`（从不 `-D`） |
| 新建 / 删除标签 | `tag <name> [<rev>]` / `tag -d` |
| 获取 / 拉取 | `fetch --all --prune` / `pull --ff-only` |
| 推送 | `push`（首次发布加 `-u <remote> <branch>`） |
| 重置 | `reset --soft` / `reset --mixed` |
| 还原 / 拣选 / 合并 | `revert --no-edit` / `cherry-pick` / `merge --no-edit` |

会移动 HEAD、改动工作区或丢弃内容的操作（放弃、删除分支/标签、切换、重置、还原、拣选、合并、拉取、推送）都会先在面板内弹出确认框，取消则不会发出任何请求。

面板**故意不提供**的破坏性操作：`push --force`、`branch -D`、`checkout --force`、`reset --hard`、`rebase`，以及删除未跟踪文件。它们都会不可逆地丢工作，宁可不做也不加一个"确认"了事。

## 测试

```
pnpm test          # 或：node tools/smoke.mjs && node tools/client-smoke.mjs
```

- [`tools/smoke.mjs`](tools/smoke.mjs)：Host 半（51 项断言）。对着临时仓库跑真实的 git 参数与解析器，覆盖暂存/提交/diff/历史/分支/标签/放弃/reset/还原/拣选/合并、名称与路径守卫、只读栅栏。远程同步用本地裸仓库做端到端验证；本机沙箱会挡掉 git 的本地传输（`sh.exe` 建不了信号管道），那一项会明确显示 `SKIP` 而不是假装通过，在不受限的环境下重跑即可执行。
- [`tools/client-smoke.mjs`](tools/client-smoke.mjs)：Client 半（87 项断言）。用一个微型 React 运行时把面板渲染到桩 Host API 上，覆盖分组、目录折叠、diff 行号/词级高亮/hunk 折叠、提交图几何、暂存与放弃、确认弹窗的"确认/取消"两条路径、分支与标签表单、历史工具栏的获取/拉取/推送、空态与错误重试。

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

- 每个请求先过 `connection.requestRejection`；工作区目录必须属于已注册工作区；路径必须是仓库内相对路径且不含 `..`；分支名、标签名、rev 都先本地白名单校验再交给 git。
- 命令是固定参数表，用户输入只出现在分支名、标签名、rev、路径这几个位置，没有把任意参数透传给 git 的通道。
- 写操作串行执行，避免争抢 git 的 index 锁；写命令用更长的 `writeTimeoutMs`（网络操作可能慢）。
- 仓库没有配置 `user.name` / `user.email` 时提交按钮禁用并给出提示。
- 冲突交给 git 报告：merge / cherry-pick / revert / pull 遇到冲突时错误原样显示，不会自动 abort，也不会替你决定。

## 实现说明

浏览器只是渲染层，所有 git 调用都在 Host：Client 通过同源 `fetch` 访问 `/git-panel/*`（`status`、`diff`、`log`、`commit`、`branches`、`stage`、`unstage`）。这与 `open-in-app` 的 Host/Client 配对方式一致，避免在纯 JS bundle 里手写 typert 代码生成产物。

样式只用 `--dsw-alias-*` 主题 token，所有文案走 `ctx.locale`，插件的每个注册都由 `ctx.effect` 持有，卸载即回收。
