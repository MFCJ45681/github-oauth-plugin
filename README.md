# @local/github-oauth

> 当前版本 **0.9.4**（变更见 [CHANGELOG.md](CHANGELOG.md)）

DSH 插件：用 **GitHub OAuth（authorization code + 网页回调）** 连接 GitHub，把 `client_secret` 与 access token **AES-256-GCM 加密后落盘**，并同时提供：

- 对话内的 `github_*` 原生工具（15 个）
- 输入框下方的**账户按钮**（紧挨权限管理）：默认只显示头像，点击展开账户列表，一键切换多份 GitHub 账户
- **内置默认 OAuth App**：装好就能登录，不必先去 GitHub 建应用；也可随时换成自己的应用
- 右侧栏 **GitHub** 面板（登录状态 / 仓库速览）
- **设置 → GitHub** 页面：更换 OAuth App、切换/移除账户、管理默认仓库与固定仓库
- 同源 HTTP 路由 `/plugins/github-oauth/*`（面板和工具共用）

```
github-oauth-plugin/     ← 仓库根就是插件包，可直接被 dsh plugin add / 插件市场安装
├── lib/{crypto,vault,default-app,oauth,github-api,auth,state,context,routes,tools,index,client}.js
├── scripts/configure.js
├── package.json
├── cordis.patch.yml
├── test/                ← node:test，45 个用例
├── install.sh
└── uninstall.sh
```

## 安装

用 DSH 官方插件命令（推荐，等同插件市场的安装方式）：

```bash
dsh plugin --profile web add github:MFCJ45681/github-oauth-plugin
# 然后重启 DSH（正在运行的进程不会重新加载 bundle）
```

或从源码检出安装：

```bash
DSH_PROFILE_DIR=/root/projects/.dsh/profiles/web ./install.sh
```

`dsh plugin add` 走 pnpm 安装到 `<profile>/node_modules/@local/github-oauth` 并写入
`dsh.profile.bundles`；`install.sh` 是离线等价操作（复制 `lib/`、`scripts/`、
`package.json`、`cordis.patch.yml`，再原子改写 profile `package.json`）。
卸载：`./uninstall.sh [--purge]`（`--purge` 同时删除加密凭据库），或
`dsh plugin --profile web remove @local/github-oauth`。

## 第一次使用

**默认路径（推荐）**：右侧栏 `+` → **GitHub** → “使用 GitHub 登录”，在 GitHub 页面点一次授权即可。
插件自带一个内置 OAuth App（`lib/default-app.js`），所以不需要先去 GitHub 建应用。
如果浏览器是通过局域网 IP 访问 DSH，用 `github_auth_start({ publicUrl: "http://<ip>:3080" })`
或面板里的提示确认回调地址。

**换成自己的 OAuth App**（可选）：

1. 打开 https://github.com/settings/developers → **New OAuth App**
   - Homepage URL：`http://127.0.0.1:3080`（或你的 DSH 地址）
   - **Authorization callback URL**：`http://127.0.0.1:3080/plugins/github-oauth/callback`
2. 在 **设置 → GitHub → OAuth App → 使用自定义 OAuth App** 填 Client ID / Client Secret，
   保存后立即生效；也可以让 agent 调用 `github_auth_setup({ clientId, clientSecret })`，或用 CLI：

   ```bash
   node scripts/configure.js set --client-id Iv1.xxxxxxxx --client-secret-stdin
   ```

   想切回内置应用：`github_auth_setup({ useDefault: true })`，或
   `node scripts/configure.js use-default`。自定义凭据会继续躺在加密 vault 里，
   之后一句 `github_auth_setup()`（不传参）或设置页按钮就能切回去。

日常管理在 **设置 → GitHub**：切换 OAuth App、更换账号、设置默认仓库（工具省略 `repo`
参数时使用）和固定仓库。这些偏好与凭据一样写在加密 vault 里。

> 内置应用的安全边界：随插件分发的 client secret 相当于公开信息，它本身不能代表你操作
> GitHub——真正的权限来自你在授权页点下的那一次同意，换来的 token 只存在本机加密 vault 里。
> 如果这个 secret 被滥用，可在 GitHub 上轮换它，并用
> `GITHUB_OAUTH_DEFAULT_CLIENT_ID` / `GITHUB_OAUTH_DEFAULT_CLIENT_SECRET` 覆盖，
> 或直接改用你自己的应用。

## 加密设计

| 项目 | 做法 |
| --- | --- |
| 算法 | AES-256-GCM（`node:crypto`），每条记录随机 12 字节 IV |
| 密文格式 | `gho1.<base64 iv>.<base64 tag>.<base64 ciphertext>` |
| 主密钥 | `<DSH_HOME>/github-oauth/master.key`（32 字节，`0600`），或 `GITHUB_OAUTH_MASTER_KEY`（经 scrypt 派生） |
| 附加数据 | AAD 绑定 `dsh/github-oauth/vault/v1`，密文片段不能被移植 |
| 数据文件 | `<DSH_HOME>/github-oauth/vault.json`（整体一个 AEAD 信封，`0600`，tmp + rename + fsync 原子写） |
| 覆盖范围 | `client_secret`、access token、refresh token、账号信息、仓库偏好全部在信封内；磁盘上没有任何明文 |
| 读取 | 每次操作解密；进程内用 `mtimeMs:size:ino:ctimeMs` 签名缓存解密结果，文件被外部改写即失效。解密失败抛 `E_VAULT_DECRYPT`，提示主密钥不匹配或文件被篡改 |
| 对外暴露 | 面板 / 工具 / HTTP 只返回 `clientIdMasked`，**永不回显 secret 与 token** |

主密钥与密文分离存放：只拿到 `vault.json` 无法解密；单独拿到 `master.key` 也不含密文。
`GITHUB_OAUTH_DATA_DIR` 可覆盖数据目录。

## 工具

| 工具 | 说明 |
| --- | --- |
| `github_auth_status` | 配置/连接状态、scopes、凭据库位置 |
| `github_auth_setup` | 选择 OAuth App：`{ useDefault: true }` 用内置默认应用，或传 `clientId` + `clientSecret` 保存自定义应用（secret 可回退 `GITHUB_OAUTH_CLIENT_SECRET`） |
| `github_auth_start` | 生成一次性 state，返回授权链接（10 分钟、单次有效） |
| `github_auth_logout` | 注销**全部**账户（保留 OAuth App 凭据）；只移除某一个用 `github_account_remove` |
| `github_accounts` | 列出已保存的账户与当前账户（不含 token） |
| `github_account_switch` | 切换当前账户：`{ login }`；之后的工具调用都用该账户的 token |
| `github_account_remove` | 移除某个账户：`{ login }`；移除当前账户时自动提升下一个 |
| `github_api_request` | 任意 REST 调用，非 2xx 返回 `ok:false` 而非抛错 |
| `github_repo` | 仓库元数据 + 仓库上下文（README 摘要与顶层文件树） |
| `github_issues` | issue 列表（自动过滤 PR） |
| `github_pulls` | PR 列表（含 head/base、merged/draft） |
| `github_search` | repositories / issues / code / users |
| `github_file` | 读文件（base64 解码、二进制识别、截断）或列目录 |
| `github_create_issue` | 新建 issue |
| `github_preferences` | 读/写默认仓库与固定仓库（省略参数即读取） |

`github_repo` / `github_issues` / `github_pulls` / `github_file` / `github_create_issue` 的
`repo` 参数可省略：此时使用设置页里的默认仓库，未设置则返回 `E_NO_REPO` 并提示怎么配置。

**仓库上下文（0.8）**：`github_repo` / `github_issues` / `github_pulls` / `github_file` 默认会在
结果后追加一段「仓库上下文」——仓库元数据、顶层文件树（目录优先，最多 30 项）和 README 摘要
（默认 1200 字，缺 README 时降级为空）。这样一次工具调用就能拿到继续干活需要的信息，减少往返。
按 `owner/name` 缓存 60 秒；传 `withContext: false` 可关闭。

所有工具返回统一信封：

```json
{ "ok": true, "code": "OK", "text": "…", "data": {}, "status": 200,
  "rateLimitRemaining": 4999, "rateLimitReset": 1800000000, "nextUrl": "" }
```

失败也返回 `ok:false`（`E_NOT_CONFIGURED` / `E_NOT_CONNECTED` / `E_RATE_LIMIT` / `E_GITHUB` …）并附带中文提示，不会中断多工具回合。

## 多账户（0.9）

- **入口**：输入框工具行（权限管理右侧）的账户按钮——默认只显示头像、带一层淡投影，点击展开 `@login` 列表；**设置 → GitHub → 输入框按钮** 里有两个滑动开关：「显示用户名」和「按钮阴影」。**设置 → GitHub** 里也有同样的账户列表。
- **添加**：composer 下拉 →「添加其他账户…」或侧边栏面板的登录按钮，走同一个 OAuth 流程；新账户成为当前账户。
- **切换**：下拉里选另一个账户，立即生效，不需要重新登录；已保存的 token 不重新授权。
- **存储**：vault 里按 login 保存 `accounts.<login> = { token（加密）, 账号快照, scopes, connectedAt }`，
  顶层仍保留活动账户的镜像字段以兼容 0.8 的旧 vault（首次写入自动迁移）。
- **刷新**：access token 过期时只刷新**当前账户**，且不会切换账户；各账户的 refresh token 互不影响。
- **移除**：设置页或 `github_account_remove`；移除当前账户后自动切到剩下的一个，全部移除即断开连接。

## HTTP 路由

均在同源 `/plugins/github-oauth` 下（仅本机服务，无额外认证层）：

| 方法与路径 | 用途 |
| --- | --- |
| `GET /bootstrap` | 面板一次拿齐 `{ status, preferences, repos }`（未连接时 `repos: []`） |
| `GET /status` | 状态（不含 secret/token） |
| `GET /start` | 浏览器登录：302 到 GitHub，并下发 `HttpOnly; SameSite=Lax` 的 state cookie |
| `POST /start` | 工具登录：返回 `authorizeUrl` |
| `GET /callback` | 换 code、取账号、加密存 token，渲染中文结果页 |
| `POST /logout` | 清除 token |
| `POST /config` | `{ mode: "default" }` 切回内置应用，`{ mode: "custom", clientId, clientSecret }` 保存并启用自定义应用（校验同源） |
| `GET /accounts` | 已保存账户与 `activeLogin`（不含 token） |
| `POST /accounts/switch` | `{ login }` 切换当前账户（校验同源） |
| `POST /accounts/remove` | `{ login }` 移除账户（校验同源） |
| `GET /repos` | 最近仓库列表（与 `/bootstrap` 共享 30 秒缓存） |
| `GET /preferences` | 默认仓库与固定仓库 |
| `POST /preferences` | 改写上述偏好（校验同源与 `owner/name` 格式） |

CSRF：浏览器流程要求 state cookie 与 `state` 参数一致；工具流程的 state 为 256 位不可猜值且一次性消费。
所有 POST 校验 `Origin`（无 Origin 放行，跨站 403）。

## 默认权限（scopes）

`repo read:user user:email`。OAuth App 的权限在 GitHub 侧固定，插件只请求这些 scope；
如需更小权限，改 `lib/oauth.js` 的 `DEFAULT_SCOPE` 后重装。

## 性能（0.8）

| 位置 | 做法 |
| --- | --- |
| vault 读取 | 解密结果按文件签名缓存，`status()` 从 6 次同步读 + 6 次解密降到 1 次读 + 1 次解密 |
| token 刷新 | 单飞（single-flight）：并发工具同时发现过期也只打一次 token 端点，避免 refresh token 被轮换两次 |
| GitHub GET | 进程内共享缓存（工具 15 秒、`/repos` 30 秒），写操作清空；`github-api` 构造项可调 |
| 面板加载 | 一个 `/bootstrap` 替代 `/status` + `/preferences` + 首屏 `/repos`，15 秒内复用 |
| 登录轮询 | 2 秒一次、后台标签页暂停、连接成功立即停止 |
| 仓库上下文 | 按仓库缓存 60 秒，README 与文件树并行请求 |
| 安装 | 内容哈希未变时跳过复制与 profile 改写，重复安装近乎瞬时 |
| 目录检查 | `mkdir` + `chmod` 每个 VaultStore 只做一次；目录被删后写入会自动重建 |

## 测试

```bash
npm test          # 等价于 node --test test/*.test.js
# 45 pass
```

覆盖：AES-GCM 往返/篡改/AAD、scrypt 派生、磁盘无明文与 `0600`、主密钥不匹配、state 一次性/过期/上限、
授权 URL 与回调、坏 state 拒绝、完整登录流、仓库列表、`/bootstrap` 与缓存、跨站写拒绝、未登录错误信封、
PR 过滤、非 2xx 处理、单飞刷新、仓库上下文构建与缓存；
客户端 bundle 的 UMD 契约、apply 注册的 tab / pane 槽 / `settings.section`、未配置态渲染；
偏好读写（默认仓库、固定仓库、非法格式拒绝、默认仓库回填）。

## 故障排查

| 现象 | 处理 |
| --- | --- |
| 侧边栏 / 设置里没有 GitHub 入口 | 确认已重启 DSH；`grep github-oauth <profile>/package.json` |
| 不想用内置默认应用 | 设置页切到自定义，或 `github_auth_setup({ clientId, clientSecret })`；也可用 `GITHUB_OAUTH_DEFAULT_*` 覆盖内置值 |
| 回调 400 “state 校验失败” | 授权链接过期（10 分钟）或重复使用；重新登录 |
| 回调 400 “授权被取消” | 在 GitHub 页面点了取消，属正常 |
| `E_VAULT_DECRYPT` | `master.key` 与 `vault.json` 不配套；删除 `<DSH_HOME>/github-oauth/vault.json` 重新授权 |
| `redirect_uri` mismatch | OAuth App 的回调地址与面板/工具显示的地址不一致（IP、端口、`publicUrl`） |
| 面板显示已配置但未连接 | 完成一次浏览器授权即可 |
| 工具结果里没有「仓库上下文」 | 传了 `withContext: false`，或 README/contents 读取失败（会自动跳过，不影响主结果） |
| 并发工具偶发 401 | 0.8 起刷新已单飞；若仍出现，检查是否有第二个 DSH 实例在用同一 vault |
