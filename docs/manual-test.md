# 手动测试流程（面板的 git 操作）

自动化测试（`pnpm test`，Host 68 + Client 126 条断言）覆盖的是**逻辑与参数**：命令表、守卫、解析器、渲染树、确认路径。它**看不到**真实的像素、悬停、焦点、以及"两个操作接连做"时的状态。这份流程补的就是那一半，按顺序做一遍大约 20 分钟。

## 0. 准备

**先重启**：Host 半的改动（`/git-panel/head`、`remotes` 带 URL）只在启动时加载。托盘右键**彻底退出**再打开，关窗口不算。

**再建一个专用测试仓库**（不要用 `F:\dsh-git` 或你的真实项目——下面的写操作会真的改工作区）：

```powershell
$lab = 'F:\git-lab'
if (Test-Path $lab) { Remove-Item $lab -Recurse -Force }
$null = New-Item -ItemType Directory -Path $lab
Set-Location $lab

# 一个本地裸仓库当"远程"，这样 fetch/pull/push 可以离线测，不碰真远程
git init --bare -b main "$lab-remote.git"
git init -b main .
git config user.name 'Git Panel Tester'
git config user.email 'tester@example.com'
git remote add origin "$lab-remote.git"

# 基线提交（PS 5.1 的 -Encoding utf8 会写 BOM，所以中文用 .NET 写，避免 diff 里混进不可见字符）
Set-Content -Encoding ascii 'line one' -Path a.txt
[System.IO.File]::WriteAllText("$lab\中文名.txt", "初始内容")
Set-Content -Encoding ascii 'neighbour' -Path 'file1.txt'
Set-Content -Encoding ascii 'bracket'   -Path 'file[1].txt'
git add -A
git commit -m 'base: initial files'
git push -u origin main

# 一条特性分支、一个标签、一个合并提交（菱形拓扑）
git switch -c feature
Set-Content -Encoding ascii 'feature work' -Path feature.txt
git add -A; git commit -m 'feature: add feature.txt'
git switch main
git tag v0.1.0
git merge --no-ff feature -m 'merge: feature into main'

# 一对会冲突的分支（留给面板制造冲突）
git switch -c conflict-a
Set-Content -Encoding ascii 'from a' -Path conflict.txt
git add -A; git commit -m 'conflict: a'
git switch main
git switch -c conflict-b
Set-Content -Encoding ascii 'from b' -Path conflict.txt
git add -A; git commit -m 'conflict: b'
git switch main

# 二进制文件，并改成另一个版本（测二进制 diff）
[System.IO.File]::WriteAllBytes("$lab\bin.dat", [byte[]](0..255))
git add -A; git commit -m 'test: binary file'

# ---- 最后才留脏状态，否则会被上面的 git add -A 一起提交掉 ----
Set-Content -Encoding ascii 'line one changed' -Path a.txt          # 未暂存
Set-Content -Encoding ascii 'staged content'   -Path b.txt          # 已暂存
git add b.txt
Set-Content -Encoding ascii 'brand new'        -Path untracked.txt  # 未跟踪
[System.IO.File]::WriteAllText("$lab\中文名.txt", "改过的中文内容")   # 非 ASCII 路径的 diff
[System.IO.File]::WriteAllBytes("$lab\bin.dat", [byte[]](0..200))    # 二进制改动

git status --short --branch
git log --oneline --graph --all
```

跑完应该看到：`main...origin/main [ahead 3]`，工作区有 **未暂存** `a.txt` / `bin.dat` / `中文名.txt`、**已暂存** `b.txt`（新文件，标 `A`）、**未跟踪** `untracked.txt`；历史里有一个合并提交和两条各自提交过的 `conflict-a` / `conflict-b`。这就是下面所有用例依赖的初始状态。

git status --short --branch
git log --oneline --graph --all
```

**然后开一个新会话**，工作区选 `F:\git-lab`（新会话的 Hero 上有工作区选择），在这个会话里做下面的测试。旁边留一个终端对账——这是关键：**面板说做了什么，就用 git 命令核对是不是真的那样**。

**动手前留一份快照**，用来证明"取消"和"拒绝"真的什么都没做：

```powershell
$snap='F:\git-lab'
git -C $snap status --porcelain=v2 > "$snap\..\before-status.txt"
git -C $snap reflog > "$snap\..\before-reflog.txt"
```

## 1. 改动页

| # | 操作 | 预期 | 终端对账 |
| --- | --- | --- | --- |
| 1.1 | 打开右侧栏 `+` → **Git** | 三个页签；顶部显示 `main`、`origin/main`、`↑0 ↓0` 左右 | `git status -sb` |
| 1.2 | 看分组 | **未暂存**：`a.txt`、`bin.dat`、`中文名.txt`；**已暂存**：`b.txt`（新文件，标 `A`）；**未跟踪**：`untracked.txt`；四组标题带计数 | `git status --short` |
| 1.3 | 点 `a.txt` | 右侧出现 diff：旧新行号、`-line one` / `+line one changed`、单行替换有词级高亮 | `git diff -- a.txt` |
| 1.4 | 点 `bin.dat` | 明确显示"二进制文件，无法显示文本差异"，不是空白也不是乱码 | `git diff --stat -- bin.dat` |
| 1.5 | 点 `中文名.txt` | 文件列表与 diff 头部显示**完整中文名**，不是 `?` 或 `"\344\270..."` 这种转义 | `git diff -- 中文名.txt` |
| 1.6 | 行上「暂存」`a.txt` | 它移到已暂存组；图标/字母更新（`M`） | `git status --short`（`M ` 在第一列） |
| 1.7 | 分组头「全部暂存」 | 该组全部进索引 | 同上 |
| 1.8 | 工具栏「全部取消暂存」 | 索引清空，改动回到未暂存 | `git status --short` |
| 1.9 | 提交框输入信息，按 **Ctrl+Enter** | 提交成功、通知条出现、清单变干净、历史多一条 | `git log -1 --stat` |
| 1.10 | 提交框留空点提交 | 按钮禁用或明确提示，**不会**发出请求 | `git log -1` 不变 |
| 1.11 | 目录行点击 | 折叠/展开该目录下的文件；根目录行不显示多余层级 | — |

## 2. 历史页

| # | 操作 | 预期 | 终端对账 |
| --- | --- | --- | --- |
| 2.1 | 切到历史 | 提交图**行行相连**：泳道线穿过每一行、拐弯是圆角、提交点是实心彩点；每行有引用 chip 和 `作者 · 日期 · 短哈希` | `git log --oneline --graph --all` |
| 2.2 | 找那个 `merge: feature into main` | 它有两个父提交，图上两条线在**菱形**处正确汇聚（不在中间某个提交上拐错） | `git log --graph --oneline --all` |
| 2.3 | 点进任意提交 | 下方显示完整改动（多文件分节，标 `+增 −删`） | `git show --stat <hash>` |
| 2.4 | 点进那个 **merge** 提交 | 显示的是两方差异（不是 `@@@` 组合差异的乱码） | `git show <hash>` 对比 |
| 2.5 | 工具栏「获取」 | 直接执行（不弹确认），通知条出现 | `git fetch --all --prune` |
| 2.6 | 「拉取」 | 先弹确认（写明"只做快进式"），取消不发请求；确认后成功 | `git pull --ff-only` |
| 2.7 | 「推送」 | 先弹确认；成功后 `↑/↓` 归零 | `git log origin/main..main` 为空 |
| 2.8 | 提交详情里「检出」 | 弹确认（写明会进入游离 HEAD）；确认后顶部显示"游离 HEAD" | `git status -sb` 首行 `HEAD (no branch)` |
| 2.9 | 「软重置」/「混合重置」 | 各自弹确认；重置后改动按 soft/staged 语义落在清单里 | `git log -1`、`git status` |
| 2.10 | 「还原」（revert） | 弹确认；生成一条 revert 提交 | `git log --oneline -2` |
| 2.11 | 「拣选」（cherry-pick） | 弹确认；把该提交搬到当前分支 | `git log --oneline -2` |

## 3. 分支页

| # | 操作 | 预期 | 终端对账 |
| --- | --- | --- | --- |
| 3.1 | 切到分支 | 四组：本地 / 远程分支 / 标签 / 远程仓库；每行两行结构（名字 + `短哈希 · 日期 · 标题`） | `git branch -a`、`git tag` |
| 3.2 | 看当前分支 | `main` 有品牌色圆点、加粗、`当前` 徽章、整行淡底；右侧 `↑/↓` 计数与 `→ origin/main` | `git status -sb` |
| 3.3 | 看远程分支 | `origin/main` 带「当前分支的上游」；`ustc/*` 之类若没有上游就不带 | `git for-each-ref` |
| 3.4 | 看远程仓库 | `origin` 下面显示**裸仓库的路径**（不是空的） | `git remote -v` |
| 3.5 | 「新建分支」→ `try/one` → 创建 | 表单可填名称与起点；回车或按钮创建；**不弹确认**（非破坏性）；建完自动切过去 | `git branch`、`git status -sb` |
| 3.6 | 切回 `main` | 弹确认；成功后顶部与胶囊都变 | `git status -sb` |
| 3.7 | 「合并」`feature`（已合并过） | 弹确认；提示 Already up to date 之类 | `git merge feature` |
| 3.8 | 「删除」一个**未合并**的分支（如 `conflict-b`） | **被拒绝**并给出 git 原话（未合并），分支仍在 | `git branch` 里它还在 |
| 3.9 | 「删除」一个已合并的分支 | 弹确认（写明"只做安全删除"）；成功后消失 | `git branch -d <name>` |
| 3.10 | 「新建标签」`v0.2.0` | 创建成功，出现在标签组 | `git tag` |
| 3.11 | 「删除」标签 | 弹确认；成功后消失 | `git tag` |

## 4. 输入框下的分支胶囊

| # | 操作 | 预期 |
| --- | --- | --- |
| 4.1 | 看输入框下方那排 | 胶囊与旁边"轮/步/tok"**同一行高**、无边框、颜色同级；有图标与分支名 |
| 4.2 | 悬停胶囊 | 与旁边小按钮同款底色变化 |
| 4.3 | 点击 | 菜单**向上**弹出，背景与旁边的弹层一致；列表只含**本地分支**，当前分支打勾且不可点 |
| 4.4 | 选另一个分支 | 先出现确认（写明切换会更新工作区文件）；**取消 → 终端 `git status` 完全不变**（与 `before-status.txt` 比对） |
| 4.5 | 确认切换 | 分支真的换了；胶囊与面板头部同步更新 |
| 4.6 | 切到一个**工作区有冲突改动**的场景再切分支 | git 拒绝时，面板原样显示 git 的错误，不吞掉 |
| 4.7 | 把工作区换成一个**非 git 目录**（新会话） | 整个胶囊不出现（没有空壳），旁边统计照常 |
| 4.8 | 在面板里「检出」某提交后再看胶囊 | 显示"游离 HEAD" |

## 5. 安全边界专项（最该测的一组）

| # | 操作 | 预期 |
| --- | --- | --- |
| 5.1 | 逐个触发**破坏性**操作并一律点「取消」 | 一个请求都不发；`git status --porcelain=v2` 与 `git reflog` 与快照**逐字节一致** |
| 5.2 | 「放弃」`untracked.txt` | **明确拒绝**并说明原因（那是删文件，不是还原）；文件仍在 |
| 5.3 | 「放弃」一个已跟踪文件的改动 | 弹确认（写明"无法恢复"）；确认后回到提交内容 |
| 5.4 | 「放弃」`file[1].txt`（先各自改成不同内容） | 只还原 `file[1].txt`；**邻居 `file1.txt` 的改动必须保留**（这是字符类展开的回归用例） |
| 5.5 | 制造合并冲突：`conflict-a` 上合并 `conflict-b` | 面板显示 git 的冲突原话；**不自动 abort**；`git status` 里是 unmerged；随后可用面板暂存 + 提交把它了结 |
| 5.6 | 确认框按 **Escape** / 点「取消」 | 关闭且不发请求（焦点默认在取消上） |
| 5.7 | 找不到任何"强推/`-D`/`--hard`/`rebase`"入口 | 面板里确实没有这些按钮（这是设计承诺，不是遗漏） |
| 5.8 | *可选*：把 profile 里这一行的 `config` 设为 `{ "allowWrite": false }` 再重启 | 所有写按钮禁用，且 Host 端**直接拒绝**（不是只置灰） |

## 6. 边界状态

| # | 场景 | 预期 |
| --- | --- | --- |
| 6.1 | 空仓库（`git init` 后无提交） | 明确显示"还没有任何提交"，而不是报错；提交按钮在填入信息后可提交第一个 |
| 6.2 | 非 git 目录 | 三类空态文案之一明确说明"不是 git 仓库"，并给出目录路径 |
| 6.3 | 游离 HEAD | 顶部显示"游离 HEAD"，分支页可切回任意分支 |
| 6.4 | 没有配置 `user.name`/`user.email` 的仓库 | 提交按钮禁用并说明原因，而不是等你写完信息才失败 |
| 6.5 | 侧栏很窄时 | 长分支名/长上游名以省略号截断，不换行、不溢出 |

## 7. 只有人能看的部分（自动化测不到）

- 三种页签的**视觉一致性**：按钮描边、悬停态、禁用态、间距是否像一个整体
- **浅色 / 深色**主题下都读得清（尤其 diff 的词级高亮、图的泳道颜色、当前分支的淡底）
- 胶囊的**菜单是否被上方内容裁切**（我设了层级，但组件库的浮层可能更高）
- **键盘**：Tab 能到各按钮、确认框能 Escape 关闭、提交框 Ctrl+Enter
- **鼠标**：右键/中键不会误触发操作；拖动选择文本不会被当成点击
- 提交图的连线在**真实大历史**（几百条）下是否仍然连续、滚动是否流畅

## 8. 收尾

```powershell
git -C F:\git-lab status --short --branch
git -C F:\git-lab log --oneline --graph --all -20
# 确认无误后删掉测试仓库（含裸远程）
Remove-Item F:\git-lab -Recurse -Force
Remove-Item F:\git-lab-remote.git -Recurse -Force
Remove-Item F:\before-status.txt, F:\before-reflog.txt -Force
```

**发现问题时**把这三样一起给我最省事：①截图；②面板里那条通知/错误**原文**；③终端里对应的 `git` 命令输出（以及 `git status --short --branch`）。有这三样我基本能直接定位，不用你复述。
