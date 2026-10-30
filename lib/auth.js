'use strict'

/**
 * Authorization glue shared by the HTTP callback and the agent tools: complete
 * a code exchange, or read a usable access token (refreshing it first when the
 * OAuth App issues expiring tokens).
 */

const { exchangeCode, refreshAccessToken, fetchAccount, parseScopes } = require('./oauth')

const REFRESH_WINDOW_MS = 60 * 1000

class AuthError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   */
  constructor (message, code) {
    super(message)
    this.name = 'AuthError'
    this.code = code || 'E_AUTH'
  }
}

/**
 * Exchange an authorization code, read the account, persist everything.
 * @param {import('./vault').VaultStore} store
 * @param {{code: string, redirectUri: string, fetchImpl?: typeof fetch}} input
 * @returns {Promise<object>} the secret-free status after connecting.
 */
async function completeAuthorization (store, { code, redirectUri, fetchImpl = fetch }) {
  const credentials = store.credentials()
  if (credentials.clientId === '' || credentials.clientSecret === '') {
    throw new AuthError('GitHub OAuth App credentials are not configured', 'E_NOT_CONFIGURED')
  }
  const token = await exchangeCode({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    code,
    redirectUri,
    fetchImpl
  })
  const { account, scopes } = await fetchAccount({ accessToken: token.accessToken, fetchImpl })
  store.setToken(token, account, scopes.length > 0 ? scopes : parseScopes(token.scope))
  return store.status()
}

/**
 * Resolve a non-expired access token, refreshing it when possible.
 * @param {import('./vault').VaultStore} store
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [options]
 * @returns {Promise<string>}
 */
async function requireAccessToken (store, { fetchImpl = fetch, now = Date.now } = {}) {
  const token = store.token()
  if (token === null) {
    throw new AuthError('GitHub is not connected yet; run github_auth_start and finish the browser flow', 'E_NOT_CONNECTED')
  }
  const expiring = token.expiresAt > 0 && token.expiresAt - now() < REFRESH_WINDOW_MS
  if (!expiring) return token.accessToken
  if (token.refreshToken === '') {
    throw new AuthError('the GitHub access token has expired and no refresh token is stored; reconnect with github_auth_start', 'E_TOKEN_EXPIRED')
  }
  const credentials = store.credentials()
  if (credentials.clientId === '' || credentials.clientSecret === '') {
    throw new AuthError('cannot refresh the GitHub token: OAuth App credentials are missing', 'E_NOT_CONFIGURED')
  }
  const refreshed = await refreshAccessToken({
    clientId: credentials.clientId,
    clientSecret: credentials.clientSecret,
    refreshToken: token.refreshToken,
    fetchImpl
  })
  const raw = store.read()
  const account = raw.account !== null && typeof raw.account === 'object'
    ? raw.account
    : { login: '', id: 0, name: '', avatarUrl: '' }
  store.setToken(
    { ...refreshed, refreshToken: refreshed.refreshToken || token.refreshToken },
    account,
    parseScopes(refreshed.scope)
  )
  return refreshed.accessToken
}

module.exports = { AuthError, completeAuthorization, requireAccessToken, REFRESH_WINDOW_MS }
