'use strict'

/**
 * Native DSH tools for GitHub.
 *
 * Every tool returns the same envelope so the model can read one shape:
 *   { ok, code, text, data, status, rateLimitRemaining, rateLimitReset, nextUrl }
 * `text` is the human/model-facing summary, `data` the structured payload.
 * Failures are returned (ok:false) rather than thrown, so a rejected call does
 * not abort a multi-tool turn.
 */

const { DEFAULT_SCOPE, buildAuthorizeUrl } = require('./oauth')
const { AuthError, requireAccessToken } = require('./auth')
const { GitHubApi, GitHubApiError } = require('./github-api')
const { CALLBACK_PATH } = require('./routes')

const MAX_TEXT_CHARS = 200000
const DEFAULT_TEXT_CHARS = 20000
const DEFAULT_FILE_CHARS = 40000

const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    ok: { type: 'boolean', required: true },
    code: { type: 'string', required: true },
    text: { type: 'string', required: true },
    data: { type: 'json' },
    status: { type: 'integer' },
    rateLimitRemaining: { type: 'json' },
    rateLimitReset: { type: 'json' },
    nextUrl: { type: 'string' }
  }
}

/** @param {unknown} value @param {number} max @returns {string} */
function stringifyBounded (value, max) {
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (text === undefined) return ''
  return text.length > max ? `${text.slice(0, max)}\n… (truncated, ${text.length} chars total)` : text
}

/** @param {unknown} error @returns {string} */
function errorCode (error) {
  if (error instanceof AuthError) return error.code
  if (error instanceof GitHubApiError) return error.code
  if (error && typeof error.code === 'string' && error.code !== '') return error.code
  return 'E_INTERNAL'
}

/** @param {string} code @returns {string} */
function hintForCode (code) {
  switch (code) {
    case 'E_NOT_CONNECTED':
      return 'GitHub 尚未连接。先调用 github_auth_status 查看配置状态，再调用 github_auth_start 并在浏览器完成授权。'
    case 'E_NOT_CONFIGURED':
      return '尚未配置 GitHub OAuth App。先调用 github_auth_setup({ clientId, clientSecret })。'
    case 'E_TOKEN_EXPIRED':
      return '访问令牌已过期且无法刷新。重新运行 github_auth_start 完成一次授权。'
    case 'E_VAULT_DECRYPT':
      return '无法解密本地凭据库：主密钥与密文不匹配，或 vault.json 被改动。修复 master.key 或删除 vault.json 后重新授权。'
    case 'E_NO_REPO':
      return '这次调用没有指定仓库，也没有设置默认仓库。可以在设置 → GitHub 里设置默认仓库，或调用 github_preferences({ defaultRepo: "owner/name" })，也可以直接给 repo 参数。'
    case 'E_RATE_LIMIT':
      return 'GitHub API 速率限制已用尽，等 rateLimitReset 之后再试。'
    default:
      return ''
  }
}

/**
 * @param {{ok: boolean, code: string, text: string, data?: unknown, status?: number, rateLimit?: {remaining: number|null, reset: number|null}|null, nextUrl?: string}} input
 */
function envelope ({ ok, code, text, data = null, status = 0, rateLimit = null, nextUrl = '' }) {
  return {
    ok,
    code,
    text,
    data,
    status,
    rateLimitRemaining: rateLimit ? rateLimit.remaining : null,
    rateLimitReset: rateLimit ? rateLimit.reset : null,
    nextUrl
  }
}

/** @param {unknown} error */
function failure (error) {
  const code = errorCode(error)
  const message = error && typeof error.message === 'string' ? error.message : String(error)
  const hint = hintForCode(code)
  return envelope({
    ok: false,
    code,
    text: hint === '' ? message : `${message}\n\n${hint}`
  })
}

/** @param {string} header @returns {string} */
function nextLink (header) {
  if (typeof header !== 'string') return ''
  const match = /<([^>]+)>\s*;\s*rel="next"/.exec(header)
  return match === null ? '' : match[1]
}

/**
 * Translate a GitHub REST response into the tool envelope.
 * @param {Awaited<ReturnType<GitHubApi['request']>>} response
 * @param {(json: any) => {text: string, data?: unknown}} summarize
 * @param {number} maxChars
 */
function respond (response, summarize, maxChars = DEFAULT_TEXT_CHARS) {
  const rateLimit = response.rateLimit
  if (!response.ok) {
    const message = response.json && typeof response.json.message === 'string'
      ? response.json.message
      : response.text.slice(0, 500)
    const documentation = response.json && typeof response.json.documentation_url === 'string'
      ? `\n文档：${response.json.documentation_url}`
      : ''
    const limited = rateLimit.remaining === 0
    return envelope({
      ok: false,
      code: limited ? 'E_RATE_LIMIT' : 'E_GITHUB',
      text: `GitHub API 返回 HTTP ${response.status}。${message}${documentation}` +
        (limited ? `\n\n速率限制已用尽，重置时间戳 ${rateLimit.reset}（Unix 秒）。` : ''),
      data: response.json,
      status: response.status,
      rateLimit,
      nextUrl: nextLink(response.link)
    })
  }
  const { text, data = null } = summarize(response.json)
  const bounded = text.length > maxChars ? `${text.slice(0, maxChars)}\n… (truncated, ${text.length} chars total)` : text
  return envelope({
    ok: true,
    code: 'OK',
    text: bounded,
    data,
    status: response.status,
    rateLimit,
    nextUrl: nextLink(response.link)
  })
}

/** @param {string} repo @returns {string} */
function requireRepo (repo) {
  const value = typeof repo === 'string' ? repo.trim() : ''
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`repo must look like "owner/name", got "${value}"`)
  }
  return value
}

/** @param {unknown} limit @param {number} fallback @returns {number} */
function clampLimit (limit, fallback) {
  const value = Number(limit)
  if (!Number.isFinite(value)) return fallback
  return Math.min(100, Math.max(1, Math.trunc(value)))
}

/** @param {string} value @returns {string} */
function encodePath (value) {
  return value.split('/').map((segment) => encodeURIComponent(segment)).join('/')
}

/** @param {{login?: string, name?: string, avatarUrl?: string}|null} account */
function accountLine (account) {
  if (account === null) return '未连接 GitHub 账号'
  const name = account.name !== '' ? ` (${account.name})` : ''
  return `已连接 GitHub 账号 @${account.login}${name}`
}

/**
 * @param {{defineTool: Function, store: import('./vault').VaultStore, states: import('./state').PendingStates, fetchImpl?: typeof fetch, port?: () => number, publicUrl?: string}} deps
 * @returns {object[]} registry-ready tool definitions.
 */
function buildTools ({ defineTool, store, states, fetchImpl = fetch, port = () => 0, publicUrl = '' }) {
  /**
   * Resolve a client for the current connection.
   * @returns {Promise<GitHubApi>}
   */
  async function client () {
    const accessToken = await requireAccessToken(store, { fetchImpl })
    return new GitHubApi({ accessToken, fetchImpl })
  }

  /**
   * Resolve the target repository: an explicit argument wins, otherwise the
   * default repository configured in Settings → GitHub.
   * @param {unknown} repo
   * @returns {string}
   */
  function resolveRepo (repo) {
    if (typeof repo === 'string' && repo.trim() !== '') return requireRepo(repo)
    const fallback = store.preferences().defaultRepo
    if (fallback !== '') return fallback
    const error = new Error('No repository was given and no default repository is configured.')
    error.code = 'E_NO_REPO'
    throw error
  }

  /**
   * @param {string} [override]
   * @returns {string}
   */
  function callbackBase (override) {
    const base = (override && override.trim() !== '' ? override : publicUrl).replace(/\/+$/, '')
    if (base !== '') return base
    return `http://127.0.0.1:${port()}`
  }

  const tools = []

  tools.push(defineTool({
    name: 'github_auth_status',
    description:
      'Show the GitHub connection status: whether the OAuth App client id/secret is configured, ' +
      'whether an account is connected, the account login, granted scopes and where the encrypted ' +
      'vault lives. Never returns the client secret or the access token.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute () {
      try {
        const status = store.status()
        const sourceLine = status.authSource === 'default'
          ? `OAuth App：内置默认应用（client_id ${status.clientIdMasked}）`
          : `OAuth App：自定义应用（client_id ${status.clientIdMasked}）`
        const lines = [
          sourceLine,
          status.hasCustomApp && status.authSource === 'default'
            ? `另有已加密保存的自定义应用（client_id ${status.customClientIdMasked}），可切换使用`
            : '',
          accountLine(status.account),
          status.connected ? `授权范围：${status.scopes.join(', ') || '(未报告)'}` : '尚无访问令牌',
          status.connected && status.tokenExpiresAt ? `令牌过期时间：${status.tokenExpiresAt}（可刷新：${status.canRefresh ? '是' : '否'}）` : '',
          `加密凭据库：${status.vault.path}（${status.vault.algorithm}，密钥来源 ${status.vault.keySource}）`
        ].filter(Boolean)
        return envelope({ ok: true, code: 'OK', text: lines.join('\n'), data: status })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_auth_setup',
    description:
      'Choose which GitHub OAuth App is used for the authorization-code flow. Pass useDefault=true to ' +
      'switch back to the built-in app (recommended, works out of the box), or pass clientId + ' +
      'clientSecret to save and use a custom OAuth App; both values are encrypted with AES-256-GCM ' +
      'before touching disk. Create a custom OAuth App at https://github.com/settings/developers and ' +
      'set its callback URL to the address printed by github_auth_start ' +
      '(…/plugins/github-oauth/callback). The secret may be omitted when GITHUB_OAUTH_CLIENT_SECRET is set.',
    parameters: {
      useDefault: { type: 'boolean', description: 'Switch to the built-in OAuth App instead of a custom one' },
      clientId: { type: 'string', description: 'Custom OAuth App client id, e.g. Iv1.0123456789abcdef' },
      clientSecret: { type: 'string', description: 'Custom OAuth App client secret; falls back to GITHUB_OAUTH_CLIENT_SECRET' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        if (args.useDefault === true) {
          const status = store.configure({ mode: 'default' })
          return envelope({
            ok: true,
            code: 'OK',
            text: `已切换到内置默认 OAuth App（client_id ${status.clientIdMasked}）。下一步：调用 github_auth_start 获取授权链接。`,
            data: status
          })
        }
        const clientId = typeof args.clientId === 'string' ? args.clientId.trim() : ''
        if (clientId === '') throw new Error('clientId 不能为空（或传 useDefault: true 使用内置默认 OAuth App）')
        const fromArg = typeof args.clientSecret === 'string' ? args.clientSecret.trim() : ''
        const fromEnv = typeof process.env.GITHUB_OAUTH_CLIENT_SECRET === 'string'
          ? process.env.GITHUB_OAUTH_CLIENT_SECRET.trim()
          : ''
        const clientSecret = fromArg !== '' ? fromArg : fromEnv
        if (clientSecret === '') {
          throw new Error('缺少 clientSecret：请传入 clientSecret，或设置环境变量 GITHUB_OAUTH_CLIENT_SECRET')
        }
        const status = store.configure({ clientId, clientSecret, mode: 'custom' })
        return envelope({
          ok: true,
          code: 'OK',
          text: `已加密保存并使用自定义 OAuth App（client_id ${status.clientIdMasked}）。下一步：调用 github_auth_start 获取授权链接。`,
          data: status
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_auth_start',
    description:
      'Create a one-time OAuth state and return the GitHub authorization URL. Open the URL in a ' +
      'browser; GitHub redirects back to the plugin callback, which exchanges the code and stores ' +
      'the encrypted token. The state expires after 10 minutes and is single use.',
    parameters: {
      publicUrl: {
        type: 'string',
        description: 'Origin the browser reaches DSH at, e.g. http://192.168.1.10:3080. Defaults to http://127.0.0.1:<port>.'
      }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const credentials = store.credentials()
        if (credentials.clientId === '' || credentials.clientSecret === '') {
          throw Object.assign(new Error('GitHub OAuth App 凭据未配置'), { code: 'E_NOT_CONFIGURED' })
        }
        const origin = callbackBase(args.publicUrl)
        const redirectUri = `${origin}${CALLBACK_PATH}`
        const pending = states.create({ redirectUri, scope: DEFAULT_SCOPE, browserBound: false })
        const authorizeUrl = buildAuthorizeUrl({
          clientId: credentials.clientId,
          redirectUri,
          state: pending.state,
          scope: DEFAULT_SCOPE
        })
        const text = [
          '在浏览器打开下面的链接完成 GitHub 授权（10 分钟内有效，仅可使用一次）：',
          '',
          authorizeUrl,
          '',
          `回调地址：${redirectUri}`,
          '若浏览器与 DSH 不在同一台机器，请用 publicUrl 参数指定浏览器可访问的地址，例如 http://192.168.1.10:3080 。',
          '授权完成后调用 github_auth_status 确认连接。'
        ].join('\n')
        return envelope({
          ok: true,
          code: 'OK',
          text,
          data: { authorizeUrl, redirectUri, expiresAt: new Date(pending.expiresAt).toISOString(), scope: DEFAULT_SCOPE }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_auth_logout',
    description: 'Forget the stored GitHub access token and account. The encrypted OAuth App client id/secret stay configured.',
    parameters: {},
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute () {
      try {
        store.clearToken()
        return envelope({ ok: true, code: 'OK', text: '已清除 GitHub 访问令牌；OAuth App 凭据仍在。', data: store.status() })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_api_request',
    description:
      'Call any GitHub REST API endpoint with the stored token, e.g. GET /user or ' +
      'POST /repos/owner/name/issues. `path` is the API path only (no host), and `query`/`body` are ' +
      'JSON values. Non-2xx responses are returned with ok:false instead of throwing.',
    parameters: {
      method: { type: 'string', enum: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'], description: 'HTTP method, defaults to GET' },
      path: { type: 'string', required: true, description: 'Absolute API path such as /repos/octocat/Hello-World' },
      query: { type: 'json', description: 'Query string parameters as a JSON object' },
      body: { type: 'json', description: 'JSON request body (POST/PATCH/PUT)' },
      maxChars: { type: 'integer', description: 'Response text budget in characters, default 20000' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const method = typeof args.method === 'string' && args.method !== '' ? args.method.toUpperCase() : 'GET'
        const api = await client()
        const query = args.query !== null && typeof args.query === 'object' && !Array.isArray(args.query) ? args.query : undefined
        const response = await api.request(method, args.path, { query, body: args.body })
        const maxChars = Math.min(MAX_TEXT_CHARS, Math.max(1000, Number(args.maxChars) || DEFAULT_TEXT_CHARS))
        return respond(response, (json) => ({
          text: `${method} ${args.path} → HTTP ${response.status}\n${response.truncated ? '(响应体已被截断)\n' : ''}${stringifyBounded(json === null ? response.text : json, maxChars)}`,
          data: { status: response.status, headers: { link: response.link }, body: json === null ? response.text : json }
        }), maxChars)
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_repo',
    description: 'Fetch metadata for one repository: description, stars, language, default branch, topics and URLs. Omit repo to use the default repository.',
    parameters: {
      repo: { type: 'string', description: 'Repository in owner/name form; omit to use the default repository set in Settings → GitHub' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const fullName = resolveRepo(args.repo)
        const api = await client()
        const response = await api.get(`/repos/${fullName}`)
        return respond(response, (json) => {
          const data = {
            fullName: String(json.full_name || fullName),
            description: typeof json.description === 'string' ? json.description : '',
            private: json.private === true,
            fork: json.fork === true,
            archived: json.archived === true,
            defaultBranch: typeof json.default_branch === 'string' ? json.default_branch : '',
            language: typeof json.language === 'string' ? json.language : '',
            stars: Number(json.stargazers_count) || 0,
            forks: Number(json.forks_count) || 0,
            openIssues: Number(json.open_issues_count) || 0,
            watchers: Number(json.subscribers_count) || 0,
            topics: Array.isArray(json.topics) ? json.topics : [],
            license: json.license && typeof json.license.spdx_id === 'string' ? json.license.spdx_id : '',
            updatedAt: typeof json.updated_at === 'string' ? json.updated_at : '',
            pushedAt: typeof json.pushed_at === 'string' ? json.pushed_at : '',
            htmlUrl: typeof json.html_url === 'string' ? json.html_url : ''
          }
          return {
            data,
            text: [
              `${data.fullName}${data.private ? ' (private)' : ''}${data.archived ? ' [archived]' : ''}`,
              data.description || '(no description)',
              `★ ${data.stars} · forks ${data.forks} · issues ${data.openIssues} · ${data.language || 'n/a'}${data.license ? ` · ${data.license}` : ''}`,
              `默认分支 ${data.defaultBranch} · 更新于 ${data.updatedAt}`,
              data.topics.length > 0 ? `topics: ${data.topics.join(', ')}` : '',
              data.htmlUrl
            ].filter(Boolean).join('\n')
          }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_issues',
    description: 'List issues of a repository (pull requests are filtered out). Supports state, label filtering and a limit. Omit repo to use the default repository.',
    parameters: {
      repo: { type: 'string', description: 'Repository in owner/name form; omit to use the default repository set in Settings → GitHub' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Issue state, defaults to open' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Only issues carrying all of these labels' },
      limit: { type: 'integer', description: 'Maximum issues to return, 1-100, default 20' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const fullName = resolveRepo(args.repo)
        const limit = clampLimit(args.limit, 20)
        const api = await client()
        const response = await api.get(`/repos/${fullName}/issues`, {
          state: typeof args.state === 'string' ? args.state : 'open',
          labels: Array.isArray(args.labels) && args.labels.length > 0 ? args.labels.join(',') : undefined,
          per_page: limit
        })
        return respond(response, (json) => {
          const items = (Array.isArray(json) ? json : []).filter((item) => !(item && item.pull_request))
          const data = items.slice(0, limit).map((item) => ({
            number: Number(item.number) || 0,
            title: typeof item.title === 'string' ? item.title : '',
            state: typeof item.state === 'string' ? item.state : '',
            author: item.user && typeof item.user.login === 'string' ? item.user.login : '',
            labels: Array.isArray(item.labels) ? item.labels.map((label) => String(label && label.name ? label.name : '')).filter(Boolean) : [],
            comments: Number(item.comments) || 0,
            createdAt: typeof item.created_at === 'string' ? item.created_at : '',
            updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
            htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
          }))
          return {
            data,
            text: data.length === 0
              ? `${fullName}: 没有匹配的 issue`
              : `${fullName}: ${data.length} 个 issue\n` + data.map((issue) =>
                `#${issue.number} [${issue.state}] ${issue.title} — @${issue.author}` +
                (issue.labels.length > 0 ? ` (${issue.labels.join(', ')})` : '') +
                `\n  ${issue.htmlUrl}`
              ).join('\n')
          }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_pulls',
    description: 'List pull requests of a repository with review/merge state and head/base branches. Omit repo to use the default repository.',
    parameters: {
      repo: { type: 'string', description: 'Repository in owner/name form; omit to use the default repository set in Settings → GitHub' },
      state: { type: 'string', enum: ['open', 'closed', 'all'], description: 'Pull request state, defaults to open' },
      limit: { type: 'integer', description: 'Maximum pull requests to return, 1-100, default 20' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const fullName = resolveRepo(args.repo)
        const limit = clampLimit(args.limit, 20)
        const api = await client()
        const response = await api.get(`/repos/${fullName}/pulls`, {
          state: typeof args.state === 'string' ? args.state : 'open',
          per_page: limit
        })
        return respond(response, (json) => {
          const items = Array.isArray(json) ? json : []
          const data = items.slice(0, limit).map((item) => ({
            number: Number(item.number) || 0,
            title: typeof item.title === 'string' ? item.title : '',
            state: typeof item.state === 'string' ? item.state : '',
            draft: item.draft === true,
            author: item.user && typeof item.user.login === 'string' ? item.user.login : '',
            head: item.head && typeof item.head.ref === 'string' ? item.head.ref : '',
            base: item.base && typeof item.base.ref === 'string' ? item.base.ref : '',
            createdAt: typeof item.created_at === 'string' ? item.created_at : '',
            updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
            mergedAt: typeof item.merged_at === 'string' ? item.merged_at : '',
            htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
          }))
          return {
            data,
            text: data.length === 0
              ? `${fullName}: 没有匹配的 pull request`
              : `${fullName}: ${data.length} 个 pull request\n` + data.map((pull) =>
                `#${pull.number} [${pull.mergedAt ? 'merged' : pull.state}${pull.draft ? ', draft' : ''}] ${pull.title} — @${pull.author}` +
                `\n  ${pull.head} → ${pull.base}\n  ${pull.htmlUrl}`
              ).join('\n')
          }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_search',
    description: 'Search GitHub repositories, issues/PRs, code or users. Uses the GitHub search API with its own rate limits.',
    parameters: {
      q: { type: 'string', required: true, description: 'Search query, GitHub syntax such as "repo:owner/name is:open label:bug"' },
      type: { type: 'string', enum: ['repositories', 'issues', 'code', 'users'], description: 'What to search, defaults to repositories' },
      limit: { type: 'integer', description: 'Maximum results to return, 1-100, default 20' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const type = typeof args.type === 'string' ? args.type : 'repositories'
        const limit = clampLimit(args.limit, 20)
        const api = await client()
        const response = await api.get(`/search/${type}`, { q: args.q, per_page: limit })
        return respond(response, (json) => {
          const items = json && Array.isArray(json.items) ? json.items : []
          const total = json && Number.isFinite(json.total_count) ? json.total_count : items.length
          /** @param {any} item */
          const map = (item) => {
            if (type === 'repositories') {
              return {
                fullName: String(item.full_name || ''),
                description: typeof item.description === 'string' ? item.description : '',
                stars: Number(item.stargazers_count) || 0,
                language: typeof item.language === 'string' ? item.language : '',
                updatedAt: typeof item.updated_at === 'string' ? item.updated_at : '',
                htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
              }
            }
            if (type === 'issues') {
              return {
                number: Number(item.number) || 0,
                title: typeof item.title === 'string' ? item.title : '',
                state: typeof item.state === 'string' ? item.state : '',
                isPullRequest: item.pull_request !== undefined,
                repo: item.repository_url ? String(item.repository_url).replace(/^.*\/repos\//, '') : '',
                htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
              }
            }
            if (type === 'code') {
              return {
                name: typeof item.name === 'string' ? item.name : '',
                path: typeof item.path === 'string' ? item.path : '',
                repo: item.repository && typeof item.repository.full_name === 'string' ? item.repository.full_name : '',
                htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
              }
            }
            return {
              login: typeof item.login === 'string' ? item.login : '',
              type: typeof item.type === 'string' ? item.type : '',
              htmlUrl: typeof item.html_url === 'string' ? item.html_url : ''
            }
          }
          const data = { total, type, items: items.slice(0, limit).map(map) }
          const lines = [`搜索 "${args.q}" (${type})：共 ${total} 个结果，显示 ${data.items.length} 个`]
          for (const item of data.items) {
            if (type === 'repositories') lines.push(`${item.fullName} ★${item.stars} — ${item.description || '(no description)'}\n  ${item.htmlUrl}`)
            else if (type === 'issues') lines.push(`${item.repo}#${item.number}${item.isPullRequest ? ' (PR)' : ''} [${item.state}] ${item.title}\n  ${item.htmlUrl}`)
            else if (type === 'code') lines.push(`${item.repo}/${item.path}\n  ${item.htmlUrl}`)
            else lines.push(`${item.login} (${item.type})\n  ${item.htmlUrl}`)
          }
          return { data, text: lines.join('\n') }
        })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_file',
    description:
      'Read one file or list one directory from a repository through the contents API. File text is decoded from base64 ' +
      'and truncated to maxChars; binary files report their size instead of the bytes.',
    parameters: {
      repo: { type: 'string', description: 'Repository in owner/name form; omit to use the default repository set in Settings → GitHub' },
      path: { type: 'string', required: true, description: 'Repository-relative path, e.g. src/index.ts' },
      ref: { type: 'string', description: 'Branch, tag or commit SHA; defaults to the repository default branch' },
      maxChars: { type: 'integer', description: 'Text budget for file content, default 40000' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const fullName = resolveRepo(args.repo)
        const filePath = typeof args.path === 'string' ? args.path.trim().replace(/^\/+/, '') : ''
        if (filePath === '') throw new Error('path 不能为空')
        const maxChars = Math.min(MAX_TEXT_CHARS, Math.max(1000, Number(args.maxChars) || DEFAULT_FILE_CHARS))
        const api = await client()
        const response = await api.get(`/repos/${fullName}/contents/${encodePath(filePath)}`, {
          ref: typeof args.ref === 'string' && args.ref !== '' ? args.ref : undefined
        })
        return respond(response, (json) => {
          if (Array.isArray(json)) {
            const entries = json.map((entry) => ({
              name: typeof entry.name === 'string' ? entry.name : '',
              path: typeof entry.path === 'string' ? entry.path : '',
              type: typeof entry.type === 'string' ? entry.type : '',
              size: Number(entry.size) || 0
            }))
            return {
              data: { kind: 'directory', path: filePath, entries },
              text: `${fullName}/${filePath} 目录（${entries.length} 项）\n` +
                entries.map((entry) => `${entry.type === 'dir' ? 'd' : '-'} ${entry.name}${entry.type === 'file' ? ` (${entry.size} B)` : ''}`).join('\n')
            }
          }
          const kind = typeof json.type === 'string' ? json.type : 'file'
          const base64 = typeof json.content === 'string' ? json.content.replace(/\s+/g, '') : ''
          const encoding = typeof json.encoding === 'string' ? json.encoding : ''
          let content = ''
          let binary = false
          if (encoding === 'base64' && base64 !== '') {
            const buffer = Buffer.from(base64, 'base64')
            const head = buffer.subarray(0, Math.min(buffer.length, 8000))
            binary = head.includes(0)
            if (!binary) content = buffer.toString('utf8')
          }
          const size = Number(json.size) || 0
          const truncated = content.length > maxChars
          const shown = truncated ? content.slice(0, maxChars) : content
          const data = {
            kind,
            path: typeof json.path === 'string' ? json.path : filePath,
            sha: typeof json.sha === 'string' ? json.sha : '',
            size,
            binary,
            encoding,
            htmlUrl: typeof json.html_url === 'string' ? json.html_url : '',
            content: binary ? '' : shown,
            truncated
          }
          return {
            data,
            text: binary
              ? `${fullName}/${data.path} 是二进制文件（${size} B），未解码内容。\n${data.htmlUrl}`
              : `${fullName}/${data.path}（${size} B）\n${data.htmlUrl}\n\n${shown}${truncated ? `\n… (truncated, ${content.length} chars total)` : ''}`
          }
        }, maxChars + 200)
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_create_issue',
    description: 'Create an issue in a repository. Requires the token to carry repository write permission. Omit repo to use the default repository.',
    parameters: {
      repo: { type: 'string', description: 'Repository in owner/name form; omit to use the default repository set in Settings → GitHub' },
      title: { type: 'string', required: true, description: 'Issue title' },
      body: { type: 'string', description: 'Issue body in GitHub-flavored Markdown' },
      labels: { type: 'array', items: { type: 'string' }, description: 'Labels to attach' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const fullName = resolveRepo(args.repo)
        const title = typeof args.title === 'string' ? args.title.trim() : ''
        if (title === '') throw new Error('title 不能为空')
        const api = await client()
        const payload = {
          title,
          body: typeof args.body === 'string' ? args.body : '',
          labels: Array.isArray(args.labels) ? args.labels : []
        }
        const response = await api.post(`/repos/${fullName}/issues`, payload)
        return respond(response, (json) => ({
          data: {
            number: Number(json.number) || 0,
            title: typeof json.title === 'string' ? json.title : title,
            state: typeof json.state === 'string' ? json.state : '',
            htmlUrl: typeof json.html_url === 'string' ? json.html_url : ''
          },
          text: `已创建 issue #${json.number}：${json.title}\n${json.html_url}`
        }))
      } catch (error) {
        return failure(error)
      }
    }
  }))

  tools.push(defineTool({
    name: 'github_preferences',
    description:
      'Read or update the GitHub preferences kept in the encrypted vault: the default repository used ' +
      'when a github_* tool call omits repo, and the pinned repository list shown in Settings → GitHub. ' +
      'Call with no arguments to read them. Pass defaultRepo:"" to clear the default, or pinnedRepos [] to clear the pins.',
    parameters: {
      defaultRepo: { type: 'string', description: 'Default "owner/name"; empty string clears it' },
      pinnedRepos: { type: 'array', items: { type: 'string' }, description: 'Replacement pinned repository list, each "owner/name"' }
    },
    output: { schema: OUTPUT_SCHEMA, render: (args, value) => [{ type: 'text', text: value.text }] },
    async execute (args) {
      try {
        const patch = {}
        if (args.defaultRepo !== undefined) patch.defaultRepo = args.defaultRepo
        if (args.pinnedRepos !== undefined) patch.pinnedRepos = args.pinnedRepos
        const preferences = Object.keys(patch).length === 0
          ? store.preferences()
          : store.setPreferences(patch)
        const lines = [
          preferences.defaultRepo === ''
            ? '默认仓库：未设置'
            : `默认仓库：${preferences.defaultRepo}`,
          preferences.pinnedRepos.length === 0
            ? '固定仓库：空'
            : `固定仓库（${preferences.pinnedRepos.length}）：${preferences.pinnedRepos.join(', ')}`,
          preferences.updatedAt === null ? '' : `更新时间：${preferences.updatedAt}`
        ].filter(Boolean)
        return envelope({ ok: true, code: 'OK', text: lines.join('\n'), data: preferences })
      } catch (error) {
        return failure(error)
      }
    }
  }))

  return tools
}

module.exports = { buildTools, OUTPUT_SCHEMA }
