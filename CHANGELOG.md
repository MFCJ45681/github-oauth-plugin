# Changelog

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
