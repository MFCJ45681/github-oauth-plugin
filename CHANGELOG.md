# Changelog

本项目基于 [MIT 许可证](LICENSE) 开源，可自由使用、修改与分发。
条目按时间倒序排列；每次发布都在 [Releases](https://github.com/MFCJ45681/github-oauth-plugin/releases) 打 tag，
下面按**变更主题**分组（越靠前越新），不再使用版本号标注。

## 图标与降级显示

- 新增**内联 GitHub 图标**（SVG + `currentColor`），不依赖任何外部图片请求；右侧栏「+」面板的 GitHub 入口现在带图标。
- 头像加载失败（离线、`avatars.githubusercontent.com` 被拦）或账号缺少 `avatarUrl` 时，自动回退为内联 GitHub 图标，不再显示浏览器的破图占位。
- 输入框账户按钮、账户下拉列表、设置页账户列表统一使用同一个 `Avatar` 组件，尺寸固定 16 / 36，避免原图撑坏布局。
- 回退图标带 `title`（`@login`），鼠标悬停可确认当前账户。

---

## 安全与性能加固

一次针对「多账户 + 本地加密 + 同源路由」的攻击面复审，同时收敛客户端交互与可访问性。

### 修复（安全）

- **跨账户缓存泄漏**：GET 缓存 key 加入 `sha256(token)` 指纹，切换账户后不会复用其他账户的响应；缓存加上限（200 条）。
- **CSRF 登出**：`/logout`、`/config`、`/accounts/*`、`POST /preferences` 只接受 POST（GET 返回 405），顶层导航无法再清空 token 或改配置。
- **刷新令牌写错账户**：刷新前捕获 token 所属 login，await 后写回该账户；保留 scopes 与旧 refresh token；每轮重读活动 token，切换/登出后不会拿到他人的令牌。
- 截断响应返回 `E_TRUNCATED`、空响应体返回 `E_EMPTY`，不再伪装成成功或空列表。
- `github_file` 拒绝空段、`.`、`..`，不会把 `../../user` 拼到 contents 之外；`encoding:"none"`（>1 MB）抛 `E_FILE_TOO_LARGE`。
- `github_api_request` 对 GET/HEAD 带 body 返回 `E_INPUT`；新增 HEAD 方法。
- 畸形 state cookie 不再 500；token 交换失败后 state 仍可重试。
- 速率限制只在 403/429 且配额耗尽（或 message 含 rate limit）时判定，404/422 不再误报。
- `writeAtomic` 失败清理临时密文文件；`vault.update()` 跨进程加锁；`removeAccount` 对未知 login 抛 `E_NOT_FOUND`。
- 客户端：未配置时不再整页跳转；授权弹窗在点击内同步打开；「添加账户」可取消、失败即停；插件自身 404 先看 `code`；轮询与刷新加序号防覆盖；事件携带 payload；侧边栏正文改用 `slots.inject`。

### 性能

- `/status`、`/accounts` 各一次读 + 一次解密；仓库上下文与 API 缓存均有上限。
- 授权轮询按标签页可见时间计 5 分钟预算，后台不消耗。
- 输入框下拉只在等待授权或菜单打开时随窗口 focus 刷新。

### 无障碍

- 凭据与仓库输入框补 `aria-label`；错误用 `role="alert"`，成功/等待用 `aria-live`；`aria-haspopup` 改为 `menu`。
- 侧边栏正文槽改用 `slots.inject`，右栏关闭/重开后正文不再丢失。

### 测试

- 新增 `test/regressions.test.js`（12 个用例）：缓存按 token 隔离、刷新落在 owner 账户、截断/空体、404 与配额、GET body、路径逃逸、大文件、GET 登出 405、畸形 cookie、state 重试、未知账户、随机 token 长度。
- 全套 **58 个用例通过**。

---

## 输入框按钮：仅头像、阴影与滑动开关

- 账户按钮去掉 `/` 恢复投影：默认是白底圆角胶囊，带一层淡投影；只露头像（圆形 28×28，`!important` 限制尺寸，避免 GitHub 原图撑坏布局）。
- 点击头像才展开账户列表，列表里显示 `@login`、姓名与当前账户标记。
- **设置 → GitHub → 输入框按钮** 提供两个滑动开关：`显示用户名`（关 = 仅头像）与 `按钮阴影`（默认开）；选择写入 localStorage，刷新后保持，并通过事件让输入框里的按钮即时更新。
- 开关带 `role="switch"` 与 `aria-checked`，键盘可操作。
- 未配置 OAuth App 时按钮提示去配置；授权弹窗被拦截时只提示，不再离开当前页面。

---

## 多账户支持

- **存储**：vault 按 login 保存 `accounts.<login> = { token（加密）, 账号快照, scopes, connectedAt }`，顶层保留活动账户镜像字段以兼容旧 vault（首次写入自动迁移）。
- **入口**：输入框工具行（权限管理右侧）的账户按钮；**设置 → GitHub** 里有同样的账户列表与「添加/切换/移除」。
- **添加**：走同一个 OAuth 流程，新账户成为当前账户；可「取消等待授权」。
- **切换**：立即生效，不重新授权；刷新只刷新当前账户，且不会切换账户。
- **移除**：移除当前账户后自动提升下一个，全部移除即断开连接，同时清掉镜像字段。
- 新增 HTTP 路由 `GET /accounts`、`POST /accounts/switch`、`POST /accounts/remove`（均校验同源）。
- 新增工具 `github_accounts`、`github_account_switch`、`github_account_remove`（工具总数 15）。
- 旧宿主（无 `/accounts`）自动回退 `GET /status`，只显示当前账户而不是报错。

---

## 设置页：账号与仓库管理

- **设置 → GitHub** 页面（`settings.section`，`id: github-oauth`）：OAuth App 来源、账号、默认仓库与固定仓库。
- 默认仓库会用于省略 `repo` 参数的工具调用；固定仓库只影响侧边栏展示顺序。
- 新增 HTTP 路由 `GET/POST /preferences`（`owner/name` 校验，非法返回 `E_INPUT`）。
- 新增工具 `github_preferences`（读/写默认仓库与固定仓库，空串/空数组表示清除）。
- 省略 `repo` 时先取默认仓库，仍为空则返回 `E_NO_REPO` 并提示怎么配置。

---

## 内置默认 OAuth App

- 插件内置一个 OAuth App（可用 `GITHUB_OAUTH_DEFAULT_CLIENT_ID/SECRET` 覆盖），装好即可登录，不必先去 GitHub 建应用。
- 仍支持自定义 OAuth App：设置页可填写并启用，也可随时切回内置默认，或切回已保存的自定义应用。
- 凭据来源写入 vault（`authSource: default | custom`），`status` 返回 `hasCustomApp` 与掩码；`POST /config` 支持 `{ mode: "default" }` 与 `{ mode: "custom", clientId, clientSecret }`。
- CLI：`node scripts/configure.js use-default`、`set --reuse-custom`、`set --client-id … --client-secret-stdin`。
- 安全边界：随插件分发的 client secret 等同公开信息，权限仍来自用户授权；不想用时在设置页切到自定义应用。
- 面板与设置页会显示「内置默认（推荐）/ 自定义」来源与切换按钮；旧 vault 自动判定来源。

---

## 首次发布：OAuth 连接与加密存储

- GitHub OAuth **authorization code + 网页回调**（`/plugins/github-oauth/callback`）；state 一次性、10 分钟 TTL，浏览器流程额外用 `HttpOnly; SameSite=Lax` cookie 绑定。
- **AES-256-GCM** 加密 `client_secret` 与 access token，主密钥 `0600` 存于 `<DSH_HOME>/github-oauth/`，密文与密钥分离；`status` 永不回显 secret/token。
- 工具：`github_auth_status`、`github_auth_setup`、`github_auth_start`、`github_auth_logout`、`github_api_request`、`github_repo`、`github_issues`、`github_pulls`、`github_search`、`github_file`、`github_create_issue`。
- 右侧栏 **GitHub** 面板 + 同源路由（`/status`、`/start`、`/callback`、`/logout`、`/config`、`/repos`）。
- 仓库上下文（README 摘要 + 顶层文件树）随 `github_repo` / `github_issues` / `github_pulls` / `github_file` 一起返回，`withContext: false` 可关闭。
- 单飞刷新、vault 读缓存、GET 缓存、`/bootstrap` 一次拿齐面板数据。
- 测试从加密/路由/工具/客户端四个层面覆盖；仓库根即插件包，可直接 `dsh plugin add github:...` 或从插件市场安装。
