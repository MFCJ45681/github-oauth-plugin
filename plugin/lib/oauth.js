'use strict'

/**
 * GitHub OAuth App web-application flow (authorization code) plus the two API
 * calls that turn a code into a usable identity: token exchange and /user.
 *
 * The plugin never starts a second server and never handles the user's GitHub
 * password: GitHub redirects the browser to the DSH web server's callback route,
 * which exchanges the one-time code server-side.
 */

const AUTHORIZE_ENDPOINT = 'https://github.com/login/oauth/authorize'
const ACCESS_TOKEN_ENDPOINT = 'https://github.com/login/oauth/access_token'
const API_BASE = 'https://api.github.com'
const USER_AGENT = 'dsh-github-oauth/1.0.0'
const DEFAULT_SCOPE = 'repo read:user user:email'

class OAuthError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, status?: number}} [options]
   */
  constructor (message, options = {}) {
    super(message)
    this.name = 'OAuthError'
    this.code = options.code || 'E_OAUTH'
    this.status = Number.isInteger(options.status) ? options.status : 0
  }
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseScopes (value) {
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(/[\s,]+/).filter(Boolean)
}

/**
 * Build the authorization URL the browser should visit.
 * @param {{clientId: string, redirectUri: string, state: string, scope?: string}} input
 * @returns {string}
 */
function buildAuthorizeUrl ({ clientId, redirectUri, state, scope = DEFAULT_SCOPE }) {
  if (!clientId) throw new OAuthError('client id is required', { code: 'E_NOT_CONFIGURED' })
  if (!redirectUri) throw new OAuthError('redirect URI is required', { code: 'E_REDIRECT_URI' })
  if (!state) throw new OAuthError('state is required', { code: 'E_STATE' })
  const url = new URL(AUTHORIZE_ENDPOINT)
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('scope', scope)
  url.searchParams.set('state', state)
  url.searchParams.set('allow_signup', 'true')
  return url.toString()
}

/**
 * @param {unknown} payload - GitHub token response.
 * @returns {{accessToken: string, tokenType: string, scope: string, refreshToken: string, expiresAt: number, refreshTokenExpiresAt: number}}
 */
function normalizeTokenResponse (payload) {
  if (payload === null || typeof payload !== 'object') {
    throw new OAuthError('GitHub returned a non-object token response', { code: 'E_TOKEN_RESPONSE' })
  }
  const body = payload
  if (typeof body.error === 'string' && body.error !== '') {
    throw new OAuthError(
      typeof body.error_description === 'string' && body.error_description !== ''
        ? body.error_description
        : body.error,
      { code: body.error }
    )
  }
  if (typeof body.access_token !== 'string' || body.access_token === '') {
    throw new OAuthError('GitHub token response carries no access_token', { code: 'E_TOKEN_RESPONSE' })
  }
  const expiresIn = Number(body.expires_in)
  const refreshExpiresIn = Number(body.refresh_token_expires_in)
  return {
    accessToken: body.access_token,
    tokenType: typeof body.token_type === 'string' ? body.token_type : 'bearer',
    scope: typeof body.scope === 'string' ? body.scope : '',
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : '',
    expiresAt: Number.isFinite(expiresIn) && expiresIn > 0 ? Date.now() + expiresIn * 1000 : 0,
    refreshTokenExpiresAt: Number.isFinite(refreshExpiresIn) && refreshExpiresIn > 0 ? Date.now() + refreshExpiresIn * 1000 : 0
  }
}

/**
 * POST the code to GitHub's token endpoint.
 * @param {{clientId: string, clientSecret: string, code: string, redirectUri: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<ReturnType<typeof normalizeTokenResponse>>}
 */
async function exchangeCode ({ clientId, clientSecret, code, redirectUri, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    redirect_uri: redirectUri
  })
  return tokenRequest(body, fetchImpl)
}

/**
 * Exchange a refresh token (GitHub issues one only when expiring tokens are on).
 * @param {{clientId: string, clientSecret: string, refreshToken: string, fetchImpl?: typeof fetch}} input
 */
async function refreshAccessToken ({ clientId, clientSecret, refreshToken, fetchImpl = fetch }) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'refresh_token',
    refresh_token: refreshToken
  })
  return tokenRequest(body, fetchImpl)
}

/**
 * @param {URLSearchParams} body
 * @param {typeof fetch} fetchImpl
 */
async function tokenRequest (body, fetchImpl) {
  let response
  try {
    response = await fetchImpl(ACCESS_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': USER_AGENT
      },
      body: body.toString(),
      signal: AbortSignal.timeout(20000)
    })
  } catch (error) {
    throw new OAuthError(`cannot reach github.com: ${error.message}`, { code: 'E_NETWORK' })
  }
  const text = await response.text()
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    throw new OAuthError(`GitHub token endpoint returned non-JSON (HTTP ${response.status})`, { code: 'E_TOKEN_RESPONSE', status: response.status })
  }
  if (!response.ok && !(payload && typeof payload.error === 'string')) {
    throw new OAuthError(`GitHub token endpoint failed with HTTP ${response.status}`, { code: 'E_HTTP', status: response.status })
  }
  return normalizeTokenResponse(payload)
}

/**
 * Read the authenticated account and the granted scopes.
 * @param {{accessToken: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<{account: {login: string, id: number, name: string, avatarUrl: string}, scopes: string[]}>}
 */
async function fetchAccount ({ accessToken, fetchImpl = fetch }) {
  let response
  try {
    response = await fetchImpl(`${API_BASE}/user`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${accessToken}`,
        'user-agent': USER_AGENT,
        'x-github-api-version': '2022-11-28'
      },
      signal: AbortSignal.timeout(20000)
    })
  } catch (error) {
    throw new OAuthError(`cannot reach api.github.com: ${error.message}`, { code: 'E_NETWORK' })
  }
  const text = await response.text()
  let user
  try {
    user = JSON.parse(text)
  } catch {
    throw new OAuthError(`GET /user returned non-JSON (HTTP ${response.status})`, { code: 'E_RESPONSE', status: response.status })
  }
  if (!response.ok || user === null || typeof user !== 'object' || typeof user.login !== 'string') {
    throw new OAuthError(
      user && typeof user.message === 'string' ? user.message : `GET /user failed with HTTP ${response.status}`,
      { code: 'E_HTTP', status: response.status }
    )
  }
  return {
    account: {
      login: user.login,
      id: Number.isFinite(user.id) ? user.id : 0,
      name: typeof user.name === 'string' ? user.name : '',
      avatarUrl: typeof user.avatar_url === 'string' ? user.avatar_url : ''
    },
    scopes: parseScopes(response.headers.get('x-oauth-scopes'))
  }
}

module.exports = {
  AUTHORIZE_ENDPOINT,
  ACCESS_TOKEN_ENDPOINT,
  API_BASE,
  DEFAULT_SCOPE,
  USER_AGENT,
  OAuthError,
  buildAuthorizeUrl,
  exchangeCode,
  refreshAccessToken,
  fetchAccount,
  normalizeTokenResponse,
  parseScopes
}
