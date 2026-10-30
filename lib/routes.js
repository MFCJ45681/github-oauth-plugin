'use strict'

/**
 * HTTP surface of the plugin, mounted on the DSH web server.
 *
 *   GET  /plugins/github-oauth/status    – secret-free connection status
 *   GET  /plugins/github-oauth/start     – create state, redirect to GitHub
 *   POST /plugins/github-oauth/start     – create state, return authorize URL
 *   GET  /plugins/github-oauth/callback  – exchange the code, render result
 *   POST /plugins/github-oauth/logout    – forget the stored token
 *   GET  /plugins/github-oauth/repos     – recent repositories (panel)
 *   POST /plugins/github-oauth/config    – select the built-in app or save a custom client id/secret
 *   GET  /plugins/github-oauth/preferences – default/pinned repositories
 *   POST /plugins/github-oauth/preferences – replace those preferences
 *
 * The callback requires the one-time `state` to match both the pending-state
 * store and the HttpOnly cookie set at /start, which blocks login CSRF (a
 * third party cannot make this browser connect to *their* GitHub account).
 */

const { buildAuthorizeUrl, DEFAULT_SCOPE, OAuthError } = require('./oauth')
const { AuthError, completeAuthorization, requireAccessToken } = require('./auth')
const { GitHubApi, GitHubApiError } = require('./github-api')
const { VaultError } = require('./vault')

const BASE = '/plugins/github-oauth'
const CALLBACK_PATH = `${BASE}/callback`
const STATE_COOKIE = 'gho_oauth_state'
const MAX_BODY_BYTES = 64 * 1024

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} payload
 * @param {Record<string, string>} [headers]
 */
function sendJson (res, status, payload, headers = {}) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers
  })
  res.end(body)
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {string} html
 */
function sendHtml (res, status, html, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'",
    'referrer-policy': 'no-referrer',
    ...headers
  })
  res.end(html)
}

/** @param {string} value */
function escapeHtml (value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]))
}

/**
 * @param {import('node:http').IncomingMessage} req
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJsonBody (req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'request body is too large')
    chunks.push(chunk)
  }
  if (size === 0) return {}
  const text = Buffer.concat(chunks).toString('utf8')
  try {
    const parsed = JSON.parse(text)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'request body must be a JSON object')
    }
    return parsed
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'request body is not valid JSON')
  }
}

class HttpError extends Error {
  /**
   * @param {number} status
   * @param {string} message
   */
  constructor (status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

/**
 * Derive the externally visible origin, honouring reverse-proxy headers.
 * @param {import('node:http').IncomingMessage} req
 * @param {number} port
 * @returns {string}
 */
function requestOrigin (req, port) {
  const forwardedProto = firstHeader(req.headers['x-forwarded-proto'])
  const forwardedHost = firstHeader(req.headers['x-forwarded-host'])
  const protocol = forwardedProto === 'https' ? 'https' : 'http'
  const host = forwardedHost || req.headers.host || `127.0.0.1:${port}`
  return `${protocol}://${host}`
}

/** @param {string|string[]|undefined} value */
function firstHeader (value) {
  if (Array.isArray(value)) return value[0] ? value[0].split(',')[0].trim() : ''
  return typeof value === 'string' ? value.split(',')[0].trim() : ''
}

/**
 * Reject cross-site POSTs from browsers. Requests without an Origin header
 * (curl, local scripts, the agent's own tooling) are allowed.
 * @param {import('node:http').IncomingMessage} req
 * @returns {boolean}
 */
function sameOriginPost (req) {
  const origin = firstHeader(req.headers.origin)
  if (origin === '') return true
  const host = firstHeader(req.headers['x-forwarded-host']) || req.headers.host || ''
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/** @param {string|undefined} header */
function parseCookies (header) {
  /** @type {Record<string,string>} */
  const out = {}
  if (typeof header !== 'string') return out
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    const name = part.slice(0, index).trim()
    if (name === '') continue
    out[name] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return out
}

/**
 * @param {string} state
 * @param {number} maxAgeSeconds
 * @returns {string}
 */
function stateCookie (state, maxAgeSeconds) {
  return `${STATE_COOKIE}=${encodeURIComponent(state)}; HttpOnly; SameSite=Lax; Path=${BASE}; Max-Age=${maxAgeSeconds}`
}

/** @param {number} maxAgeSeconds */
function clearedStateCookie (maxAgeSeconds) {
  return `${STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=${BASE}; Max-Age=${maxAgeSeconds}`
}

/**
 * Minimal, dependency-free result page for the browser that returns from GitHub.
 * @param {{ok: boolean, title: string, message: string, login?: string}} input
 */
function resultPage ({ ok, title, message, login = '' }) {
  const accent = ok ? '#2da44e' : '#cf222e'
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
    background:Canvas; color:CanvasText; }
  main { width:min(520px,92vw); padding:32px; border:1px solid color-mix(in srgb, CanvasText 14%, transparent); border-radius:14px; }
  h1 { margin:0 0 4px; font-size:19px; }
  .badge { display:inline-block; font-size:12px; font-weight:600; letter-spacing:.02em; color:#fff; background:${accent};
    padding:2px 8px; border-radius:999px; margin-bottom:14px; }
  p { margin:8px 0; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; background:color-mix(in srgb, CanvasText 8%, transparent);
    padding:2px 6px; border-radius:6px; }
  .hint { opacity:.7; font-size:13px; margin-top:18px; }
</style></head>
<body><main>
  <div class="badge">${ok ? '已完成' : '失败'}</div>
  <h1>${escapeHtml(title)}</h1>
  <p>${escapeHtml(message)}</p>
  ${login ? `<p>GitHub 账号：<code>${escapeHtml(login)}</code></p>` : ''}
  <p class="hint">可以关闭此页面并返回 DeepSeek Harness 的 GitHub 面板。</p>
  <script>setTimeout(function(){ try { window.close() } catch (e) {} }, 1200)</script>
</main></body></html>`
}

/**
 * Build route handlers bound to one vault + state store.
 * @param {{store: import('./vault').VaultStore, states: import('./state').PendingStates, fetchImpl?: typeof fetch, port?: () => number}} context
 */
function createRoutes ({ store, states, fetchImpl = fetch, port = () => 0, cache = null }) {
  const REPOS_TTL_MS = 30 * 1000

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleStatus (req, res) {
    sendJson(res, 200, { ok: true, status: store.status() })
  }

  /**
   * Recent repositories, memoised for a few seconds so both the panel and the
   * bootstrap request share one GitHub call.
   * @param {number} limit
   * @returns {Promise<object[]>}
   */
  async function recentRepos (limit) {
    const accessToken = await requireAccessToken(store, { fetchImpl })
    const api = new GitHubApi({ accessToken, fetchImpl, cache, cacheTtlMs: REPOS_TTL_MS })
    const response = await api.get('/user/repos', {
      sort: 'pushed',
      per_page: limit,
      affiliation: 'owner,collaborator,organization_member'
    })
    if (!response.ok) {
      const error = new GitHubApiError('GitHub API rejected the request', { code: 'E_API', status: response.status })
      throw error
    }
    const items = Array.isArray(response.json) ? response.json : []
    return items.slice(0, limit).map((repo) => ({
      fullName: String(repo.full_name || ''),
      description: typeof repo.description === 'string' ? repo.description : '',
      private: repo.private === true,
      language: typeof repo.language === 'string' ? repo.language : '',
      stars: Number(repo.stargazers_count) || 0,
      updatedAt: typeof repo.updated_at === 'string' ? repo.updated_at : '',
      htmlUrl: typeof repo.html_url === 'string' ? repo.html_url : ''
    }))
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleStart (req, res) {
    const credentials = store.credentials()
    if (credentials.clientId === '' || credentials.clientSecret === '') {
      sendJson(res, 409, {
        ok: false,
        error: 'GitHub OAuth App 凭据未配置',
        code: 'E_NOT_CONFIGURED',
        hint: '先执行 github_auth_setup(clientId, clientSecret)，然后在面板里重新点击登录'
      })
      return
    }
    /** @type {Record<string, unknown>} */
    let body = {}
    if (req.method === 'POST') {
      if (!sameOriginPost(req)) {
        sendJson(res, 403, { ok: false, error: 'cross-origin request rejected', code: 'E_ORIGIN' })
        return
      }
      body = await readJsonBody(req)
    }
    const scope = typeof body.scope === 'string' && body.scope.trim() !== '' ? body.scope.trim() : DEFAULT_SCOPE
    const redirectUri = `${requestOrigin(req, port())}${CALLBACK_PATH}`
    const pending = states.create({ redirectUri, scope })
    let authorizeUrl
    try {
      authorizeUrl = buildAuthorizeUrl({ clientId: credentials.clientId, redirectUri, state: pending.state, scope })
    } catch (error) {
      states.take(pending.state)
      sendJson(res, error instanceof OAuthError ? 409 : 500, {
        ok: false,
        error: error.message,
        code: error.code || 'E_OAUTH'
      })
      return
    }
    const headers = { 'set-cookie': stateCookie(pending.state, Math.floor((pending.expiresAt - Date.now()) / 1000)) }
    if (req.method === 'GET') {
      res.writeHead(302, { ...headers, location: authorizeUrl })
      res.end()
      return
    }
    sendJson(res, 200, { ok: true, authorizeUrl, redirectUri, expiresAt: pending.expiresAt }, headers)
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleCallback (req, res) {
    const url = new URL(req.url || CALLBACK_PATH, 'http://localhost')
    const cookieState = parseCookies(req.headers.cookie)[STATE_COOKIE] || ''
    const clearCookie = { 'set-cookie': clearedStateCookie(0) }
    const oauthError = url.searchParams.get('error')
    if (oauthError !== null) {
      const abortedState = url.searchParams.get('state')
      if (abortedState !== null && abortedState !== '') states.take(abortedState)
      const description = url.searchParams.get('error_description') || oauthError
      sendHtml(res, 400, resultPage({
        ok: false,
        title: 'GitHub 授权被取消',
        message: `GitHub 返回：${description}`
      }), clearCookie)
      return
    }
    const code = url.searchParams.get('code') || ''
    const state = url.searchParams.get('state') || ''
    if (code === '' || state === '') {
      sendHtml(res, 400, resultPage({ ok: false, title: '回调参数缺失', message: '链接里没有 code 或 state，请从面板重新发起授权。' }), clearCookie)
      return
    }
    if (cookieState === '' || cookieState !== state) {
      // A browser-initiated start pins the state to an HttpOnly cookie. Tool-
      // initiated starts cannot (there was no browser request), so they are
      // marked browserBound:false and validated by the unguessable value alone.
      const pendingState = states.peek(state)
      if (pendingState === null || pendingState.browserBound) {
        sendHtml(res, 400, resultPage({
          ok: false,
          title: 'state 校验失败',
          message: '这个回调不是由当前浏览器发起的授权（state 与 cookie 不匹配）。请从面板重新点击“使用 GitHub 登录”。'
        }), clearCookie)
        return
      }
    }
    const pending = states.take(state)
    if (pending === null) {
      sendHtml(res, 400, resultPage({
        ok: false,
        title: '授权请求已过期',
        message: 'state 不存在、已使用或超过 10 分钟有效期，请从面板重新发起授权。'
      }), clearCookie)
      return
    }
    try {
      const status = await completeAuthorization(store, { code, redirectUri: pending.redirectUri, fetchImpl })
      sendHtml(res, 200, resultPage({
        ok: true,
        title: 'GitHub 已连接',
        message: '授权成功，凭据已加密保存在本机。',
        login: status.account ? status.account.login : ''
      }), clearCookie)
    } catch (error) {
      const detail = error instanceof OAuthError ? `${error.message}（${error.code}）` : error.message
      sendHtml(res, 400, resultPage({
        ok: false,
        title: '换取访问令牌失败',
        message: detail
      }), clearCookie)
    }
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleLogout (req, res) {
    if (!sameOriginPost(req)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin request rejected', code: 'E_ORIGIN' })
      return
    }
    store.clearToken()
    sendJson(res, 200, { ok: true, status: store.status() })
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleConfig (req, res) {
    if (!sameOriginPost(req)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin request rejected', code: 'E_ORIGIN' })
      return
    }
    const body = await readJsonBody(req)
    const mode = body.mode === 'default' ? 'default' : (body.mode === 'custom' ? 'custom' : '')
    const clientId = typeof body.clientId === 'string' ? body.clientId.trim() : ''
    const clientSecret = typeof body.clientSecret === 'string' ? body.clientSecret.trim() : ''
    try {
      if (mode === 'default') {
        store.configure({ mode: 'default' })
      } else if (mode === 'custom' || clientId !== '' || clientSecret !== '') {
        if (mode === 'custom' && clientId === '' && clientSecret === '' && !store.storedCredentials()) {
          sendJson(res, 400, { ok: false, error: 'clientId 与 clientSecret 都必填', code: 'E_INPUT' })
          return
        }
        if ((clientId === '') !== (clientSecret === '')) {
          sendJson(res, 400, { ok: false, error: 'clientId 与 clientSecret 必须同时提供', code: 'E_INPUT' })
          return
        }
        store.configure({ clientId, clientSecret, mode: 'custom' })
      } else {
        sendJson(res, 400, { ok: false, error: 'clientId 与 clientSecret 都必填', code: 'E_INPUT' })
        return
      }
    } catch (error) {
      if (error instanceof VaultError) {
        sendJson(res, error.code === 'E_INPUT' ? 400 : 500, { ok: false, error: error.message, code: error.code })
        return
      }
      throw error
    }
    sendJson(res, 200, { ok: true, status: store.status() })
  }

  /**
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleRepos (req, res) {
    const url = new URL(req.url || `${BASE}/repos`, 'http://localhost')
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 20))
    try {
      const repos = await recentRepos(limit)
      sendJson(res, 200, { ok: true, repos })
    } catch (error) {
      const code = error instanceof AuthError ? error.code : error instanceof GitHubApiError ? error.code : 'E_INTERNAL'
      sendJson(res, code === 'E_NOT_CONNECTED' ? 409 : 502, { ok: false, error: error.message, code })
    }
  }

  /**
   * One round trip for the panel: status, preferences and (when connected)
   * the recent repository list.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handleBootstrap (req, res) {
    const status = store.status()
    let repos = []
    if (status.connected) {
      try {
        repos = await recentRepos(20)
      } catch {
        repos = []
      }
    }
    sendJson(res, 200, { ok: true, status, preferences: store.preferences(), repos })
  }

  /**
   * Read or replace the non-secret repository preferences.
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   */
  async function handlePreferences (req, res) {
    if (req.method === 'GET') {
      sendJson(res, 200, { ok: true, preferences: store.preferences() })
      return
    }
    if (!sameOriginPost(req)) {
      sendJson(res, 403, { ok: false, error: 'cross-origin request rejected', code: 'E_ORIGIN' })
      return
    }
    const body = await readJsonBody(req)
    try {
      const preferences = store.setPreferences({
        defaultRepo: body.defaultRepo,
        pinnedRepos: body.pinnedRepos
      })
      sendJson(res, 200, { ok: true, preferences })
    } catch (error) {
      sendJson(res, error instanceof VaultError && error.code === 'E_INPUT' ? 400 : 500, {
        ok: false,
        error: error.message,
        code: error instanceof VaultError ? error.code : 'E_INTERNAL'
      })
    }
  }

  /**
   * Wrap a handler so thrown HttpErrors become JSON instead of a dead socket.
   * @param {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>} handler
   */
  function wrap (handler) {
    return async (req, res) => {
      try {
        await handler(req, res)
      } catch (error) {
        if (res.headersSent) {
          res.end()
          return
        }
        const status = error instanceof HttpError ? error.status : 500
        sendJson(res, status, {
          ok: false,
          error: error && error.message ? error.message : 'internal error',
          code: error instanceof HttpError ? 'E_REQUEST' : 'E_INTERNAL'
        })
      }
    }
  }

  return {
    routes: [
      { kind: 'exact', path: `${BASE}/status`, handler: wrap(handleStatus) },
      { kind: 'exact', path: `${BASE}/bootstrap`, handler: wrap(handleBootstrap) },
      { kind: 'exact', path: `${BASE}/start`, handler: wrap(handleStart) },
      { kind: 'exact', path: CALLBACK_PATH, handler: wrap(handleCallback) },
      { kind: 'exact', path: `${BASE}/logout`, handler: wrap(handleLogout) },
      { kind: 'exact', path: `${BASE}/config`, handler: wrap(handleConfig) },
      { kind: 'exact', path: `${BASE}/repos`, handler: wrap(handleRepos) },
      { kind: 'exact', path: `${BASE}/preferences`, handler: wrap(handlePreferences) }
    ],
    BASE,
    CALLBACK_PATH
  }
}

module.exports = { createRoutes, BASE, CALLBACK_PATH, MAX_BODY_BYTES }
