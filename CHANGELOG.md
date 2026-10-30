# Changelog

## 0.9.2

修界面：输入框的账户头像被宿主样式撑成原图大小（460px），整行布局跟着崩。

### 修复

- 头像尺寸改为**内联样式 + `!important` 双重约束**（16×16 / 36×36，含 min/max 与 `flex:0 0 Npx`），
  不再依赖 class 规则在宿主样式表中的优先级。之前只要宿主的 `img` 规则优先级更高，头像就会按原图渲染。
- `.gho-cm` 增加 `max-height:28px; line-height:1`，`.gho-cm-avatar` 加 `display:block`，避免行高把控制条撑开。
- 所有头像 `<img>` 同时带 `width`/`height` 属性，样式加载前的首帧也不会闪成巨图。

### 测试

- 46 个用例保持不变，全部通过。

## 0.9.1

小修：输入框账户下拉在没有重启宿主的旧后端上不再报错，按钮改为白底圆角。

### 修复

- **下拉爆「HTTP 404」**：`/accounts` 是 0.9.0 新增路由，宿主没重启时必然 404。现在下拉先请求
  `/accounts`，404 时自动降级到 `/status`，只显示当前账户（不弹错误）；切换/添加等操作遇到 404
  会提示「插件后端还没更新（HTTP 404）。重启 DSH 后多账户功能即可用。」
- `request()` 现在把 HTTP 状态码与 `code` 挂到抛出的错误上，便于分支处理。

### 样式

- 输入框账户按钮改为**白底 + 圆角胶囊**（`#fff` 背景、1px 描边、轻阴影，hover 变浅灰）。

### 测试

- 46 个用例（+1）：`/accounts` 404 时回退 `/status` 并只降级显示当前账户。

## 0.9.0

多账户：同一份 DSH 里可以保存多个 GitHub 账号，并在输入框旁边直接切换。

### 新增

- **输入框账户下拉**：注册在 `conversation.input.left`，紧挨权限管理；显示当前账号头像与 `@login`，
  展开后可切换账户或「添加其他账户…」。新账户授权完成后自动成为当前账户。
- **设置 → GitHub → 已保存的 GitHub 账户**：列出全部账户（当前 / 切换 / 移除），与下拉共用状态。
- 3 个工具（合计 15）：`github_accounts`、`github_account_switch`、`github_account_remove`；
  `github_auth_logout` 现在表示「注销全部账户」。
- 3 条同源路由：`GET /accounts`、`POST /accounts/switch`、`POST /accounts/remove`。
- vault 账户模型：`accounts[login] = { token（加密）, 账号快照, scopes, connectedAt }` + `activeLogin`；
  旧版单 token vault 读取时自动迁移，写回后保留活动账户的顶层镜像字段。

### 修复

- **删除最后一个账户后仍然显示已连接**：`removeAccount` 清空 `accounts` 后，`mirrorActive` 又从顶层
  镜像字段重建了单账户。现在清空账户时一并删掉 `token/account/scopes/connectedAt`。
- **刷新可能串号**：token 刷新改为只写当前账户（`{ activate: false }`），不再依赖顶层字段，也就不会
  把 refresh 结果写到别的账户上。
- 并发工具共享同一次刷新时，各自拿到的仍是**当前账户**的 access token。

### 测试

- 45 个用例（+6）：多账户存取/切换/移除/最后账户删除、旧 vault 迁移、刷新只影响当前账户、
  `/accounts` 系列路由（含跨站 403 与 404）、composer 下拉渲染。

## 0.8.0

一次以「更快、更少往返」为目标的版本。没有破坏性变更：已有 vault、偏好和登录态直接沿用。

### 修复

- **侧边栏登录会把整个 DSH 页面导航走**：`window.open(url, '_blank', 'noopener,noreferrer')`
  在带 `noopener` 时恒返回 `null`，旧代码据此走 `location.assign()` 分支，导致离开 DSH 界面。
  现在先开空白标签页再清 `opener`，仅在被浏览器拦截时才回退到当前页导航。
- **并发刷新会作废 refresh token**：`requireAccessToken` 现在单飞，多个并发工具只触发一次
  刷新；GitHub 侧 refresh token 不再被轮换两次。
- **`github_file` 读大文件抛 `TypeError`**：contents API 响应超限时 `json` 为 `null`，
  旧代码继续访问 `json.type`。现在按 `maxChars` 推导 `maxBytes`，超限时明确返回
  `E_FILE_TOO_LARGE`。
- **非法仓库名被归为内部错误**：`requireRepo` 现在带 `code: 'E_INPUT'`，返回可读提示而不是 `E_INTERNAL`。
- **OAuth state 泄漏**：`/start` 在构建授权 URL 失败、`/callback` 收到 `?error=` 时都会消费掉 pending state。

### 性能

- vault 读取按文件签名（`mtimeMs:size:ino:ctimeMs`）缓存解密结果；`status()` 从
  6 次同步读 + 6 次 AES-GCM 解密降到 1 次读 + 1 次解密。
- 目录检查（`mkdir` + `chmod`）每个实例只做一次，读路径上少两个系统调用；
  缓存按 inode 变化识别外部写入，目录被删后下次写入自动重建。
- GitHub API 进程内共享 GET 缓存：工具默认 15 秒、`/repos` 30 秒，写操作清空缓存。
- 面板新增 `GET /bootstrap`，一次返回 `{ status, preferences, repos }`，替代原来的
  `/status` + `/preferences` + `/repos` 三个请求；客户端 15 秒内复用。
- 登录轮询改为 2 秒一次，页面在后台时暂停，连接成功后立刻停止；已有关联数据时不再重复拉仓库。
- 仓库上下文按 `owner/name` 缓存 60 秒，README 与文件树并行请求。
- `install.sh` 内容哈希未变时跳过复制和 profile 改写；`npm test` 一条命令跑全部用例。

### 新增：仓库上下文

`github_repo` / `github_issues` / `github_pulls` / `github_file` 默认在结果后追加「仓库上下文」：
仓库元数据、顶层文件树（目录优先、最多 30 项）、README 摘要（默认 1200 字）。
传 `withContext: false` 可关闭。实现见 `lib/context.js`。

### 测试

39 个 `node:test` 用例（新增 `test/auth.test.js` 与 `test/context.test.js`），覆盖单飞刷新、
上下文构建与缓存、`/bootstrap`、`withContext` 开关、跨实例缓存失效与目录重建等。
