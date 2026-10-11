# 给 wangfeng/tokenworks 提 PR：可执行步骤

> 本地操作手册，**未跟踪、不入库**。下列事实均为 2026-10-11 在本机实测或经 API 核对，
> 命令按 PowerShell 写法给出，bash 差异点已标注。

## 0. 结论与前提（实测）

| 项 | 结果 |
| --- | --- |
| `glab` | 已装 1.121.0；**已认证** `git.ustc.edu.cn`，身份 `Charien`（token 在系统钥匙串，API 走 HTTPS） |
| 目标项目 | `wangfeng/tokenworks`，internal，默认分支 `main`（**受保护**），MR 开启，**fork 允许** |
| 我们的权限 | `project_access: null`、`group_access: null` —— **不是成员，无法直接推分支** |
| 已有 fork | 无（`Charien/tokenworks` 尚不存在） |
| 我们的资质 | GitHub 仓库 **PUBLIC** ✓、**MIT** ✓、**没有任何 tag** ✗（对方文档硬要求 tag） |
| 对方插件惯例 | `edition/plugins/<name>/`，包名用 **`@ustc/`** 作用域（例：`@ustc/dsh-mermaid`） |
| 对方流程 | `docs/THIRD_PARTY_PLUGINS.md`：内置需审核；npm 原包走 `third_party/<名称>/LOCK.json` + `NOTICE.md` 锁定；**随核心装配的源码插件另有路径**（先例：dsh-wechat） |
| 对方提案习惯 | `docs/BACKLOG.md` 用 `- [ ]` 条目记录待办与提案 |

**一句话**：能做，但**必须走 fork → MR**，且要先决定 MR 里放什么（`F:\dsh-git` 与该仓库没有共同历史）。

## 1. 前置自检（先跑，避免白跑）

```powershell
$env:GITLAB_HOST='git.ustc.edu.cn'
glab auth status                       # 期望：✓ Logged in to git.ustc.edu.cn as Charien
glab repo view wangfeng/tokenworks     # 期望：能读到项目
git ls-remote --heads git@git.ustc.edu.cn:wangfeng/tokenworks.git   # 期望：列出 main / eduwork-core 等
```

## 2. 备资质：打 tag

对方要求"有公开源码仓库和对应 tag"。LICENSE 已是 MIT ✓，缺的只有 tag：

```powershell
cd F:\dsh-git
git tag -a v0.1.0 -m "Git panel 0.1.0"
git push origin v0.1.0        # 注意：一次推两条 pushurl（GitHub + 校内镜像）
git ls-remote --tags origin v0.1.0    # 核实
```

## 3. 审核摘要（对方 §2 要看的项，照抄我们的答案）

| 审核项 | 我们的情况 |
| --- | --- |
| 运行时依赖 | **零**：无 `dependencies`，只用 DSH 提供的服务 |
| 服务端 | 20 个 HTTP 端点（同源 `/git-panel/…`）；信任栅栏 + 只读栅栏 + 写操作串行队列；经 `ctx.subprocess` 调 `git`，经 `ctx.fs` 读文件，**唯一写入**是冲突逐块解决时的 `writeText(…, {kind:'replaceIfVersion'})`（版本守卫） |
| 网络 | **无自有请求**：只有用户自己配置的 `remote` 上的 fetch/pull/push |
| 客户端 | 同源 `fetch` 到 `/git-panel/…`；**无** `eval`/`Function`、**无** `innerHTML`、**无**浏览器存储、**无**外部 URL |
| 内部接口 | 只使用公开 slot：`sidebar.right.pane.tab` / `…tab.title` / `conversation.session.header.utilities` / `conversation.composer.dock`；样式全部自带类名 + CSS 变量，不依赖 DSH 内部 DOM |
| 数据边界 | **不注册任何 agent 工具**、不写回主会话、不读取凭据或环境变量 |
| 许可证 | MIT，素材仅自带 SVG 图标 |

## 4. Fork（会在内网新建 `Charien/tokenworks`，对内网用户可见）

```powershell
$env:GITLAB_HOST='git.ustc.edu.cn'
glab repo fork wangfeng/tokenworks --clone=false
glab repo view Charien/tokenworks      # 核实 fork 已建
```

## 5. 分支内容（二选一）

### A. Backlog 提案（最轻，建议先走这条）

```powershell
git clone git@git.ustc.edu.cn:Charien/tokenworks.git F:\tokenworks-fork
cd F:\tokenworks-fork
git remote add upstream git@git.ustc.edu.cn:wangfeng/tokenworks.git
git switch -c proposal/git-panel
```

在 `docs/BACKLOG.md` 合适小节追加一条（格式同现有条目）：

```markdown
- [ ] **内置 Git 面板插件**：提案按 `THIRD_PARTY_PLUGINS.md` 引入 `edition/plugins/tokenworks-git-panel`。
      源码 <https://github.com/charienustc/Tokenworks-git>（MIT，tag `v0.1.0`）。
      形态：会话右侧栏页签（改动/diff、提交图、分支标签、远程同步、冲突逐块解决）+ 输入框下方分支胶囊。
      边界：20 个同源只读为主端点，写操作白名单 + 串行 + 确认；不注册 agent 工具、无自有网络请求、无 eval。
      待定：走 npm 原包锁定还是源码装配、是否默认启用、是否改包名到 `@ustc/` 作用域。
```

```powershell
git add docs/BACKLOG.md
git commit -m "docs(backlog): propose bundling the git panel plugin"
git push -u origin proposal/git-panel
```

### B. 直接提 `edition/plugins/…`（改动大，对方可能要求先走审核流程）

```powershell
cd F:\tokenworks-fork
git switch -c feat/git-panel
mkdir edition\plugins\tokenworks-git-panel
# 从 F:\dsh-git 拷：index.js client.js lib\ cordis.patch.yml package.json icon.svg locale\ README.md LICENSE
```

照 `edition/plugins/dsh-mermaid` 对齐字段（关键差异）：

| 字段 | 我们的值 | 说明 |
| --- | --- | --- |
| `name` | `@ustc/tokenworks-git-panel` | 对方内置用 `@ustc/` 作用域 |
| 布局 | 建议把 `index.js` / `client.js` 移进 `lib/` | 与 `dsh-mermaid` 一致，`main`/`exports`/`files` 随之改 |
| `dsh.client` | `{platform:'web', immediately:true, inject:[…]}` | 三个 `inject` 必须保留（locale / sidebar-right / conversation） |
| `files` | `["lib","cordis.patch.yml","locale","icon.svg"]` | `locale/*.json` 是设置里显示的插件名与描述 |
| `repository` / `license` | GitHub 地址 / `MIT` | 供"插件来源"与许可记录 |

`cordis.patch.yml` 照 `dsh-mermaid` 写（我们的适配器配置项：`gitPath` `timeoutMs` `writeTimeoutMs`
`maxOutputBytes` `maxDiffBytes` `logLimit` `allowWrite` `commitNoVerify`）：

```yaml
# tokenworks-git-panel: 会话右侧栏的 Git 面板。
- insert:
    - id: git-panel
      name: 'tokenworks-git-panel'
      config:
        allowWrite: true          # 设为 false 则整块只读
        logLimit: 200
        maxDiffBytes: 524288
```

```powershell
git add -A
git commit -m "feat(plugins): add the git panel plugin"
git push -u origin feat/git-panel
```

## 6. 建 MR（两种方式，任一）

方式一（glab，跨项目写法；`--head` 指 fork）：

```powershell
$env:GITLAB_HOST='git.ustc.edu.cn'
cd F:\tokenworks-fork
glab mr create --repo wangfeng/tokenworks --head Charien/tokenworks `
  --source-branch proposal/git-panel --target-branch main `
  --title "docs(backlog): 提案内置 Git 面板插件" `
  --description "见 docs/BACKLOG.md 新增条目；源码 https://github.com/charienustc/Tokenworks-git（MIT，tag v0.1.0）" `
  --remove-source-branch --yes
```

方式二（GitLab push option，不依赖 glab 的 fork 推断）：

```powershell
git push -u origin proposal/git-panel `
  -o merge_request.create -o merge_request.target=main `
  -o merge_request.title="docs(backlog): 提案内置 Git 面板插件" `
  -o merge_request.description="见 docs/BACKLOG.md 新增条目" `
  -o merge_request.remove_source_branch
```

## 7. 提交之后

| 事项 | 说明 |
| --- | --- |
| CI | 对方 `.gitlab-ci.yml` 会跑 SAST + Secret Detection |
| 若被要求走锁定流程 | `third_party/<名称>/LOCK.json` + `NOTICE.md` 是在 **EduWork 仓库**做的，需要 EduWork 权限（我们目前没有） |
| 继续改 | 在 fork 上再 commit + push，MR 自动更新 |
| 关闭 / 清理 | `glab mr close <编号>`；删 fork 在 GitLab 项目设置里删；本地 `F:\tokenworks-fork` 可直接删 |

## 8. 注意与未验证的点

- **fork 是可见动作**：会在 `git.ustc.edu.cn` 上新建 `Charien/tokenworks`，内网用户可见。
- **MR 目标分支**：`main` 受保护，只有维护者能合并；`approvals_before_merge = 0`，即不强制审批但需对方操作。
- **非成员能否开 issue 未验证**：`issues_enabled = true`，但非成员权限未实测（要走这条路先试 `glab issue create --repo wangfeng/tokenworks ...`）。
- **不要在对方仓库里造历史**：`F:\dsh-git` 与该仓库无共同祖先，只能"新增文件"或"改 Backlog"，不能推我们的提交历史。
- **tag 一旦推送就会随镜像推到校内**（`origin` 有两条 pushurl）。
