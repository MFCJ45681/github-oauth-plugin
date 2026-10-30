'use strict'

/**
 * Authorization glue shared by the HTTP callback and the agent tools: complete
 * a code exchange, or read a usable access token (refreshing it first when the
 * OAuth App issues expiring tokens).
 */

const { exchangeCode, refreshAccessToken, fetchAccount, parseScopes } = require('./oauth')

const REFRESH_WINDOW_MS = 60 * 1000

/** One in-flight refresh per vault, so parallel tool calls do not rotate twice. */
const refreshing = new WeakMap()

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
 * Refresh the stored token exactly once per vault, sharing the in-flight
 * promise with every concurrent caller.
 *
 * The owning account is captured *before* the network call: the user may switch
 * accounts while the refresh is in flight, and the refreshed pair must still be
 * written to the account it was issued for.
 * @param {import('./vault').VaultStore} store
 * @param {NonNullable<ReturnType<import('./vault').VaultStore['token']>>} token
 * @param {{fetchImpl?: typeof fetch, login?: string}} [options]
 * @returns {Promise<{accessToken: string, login: string}>}
 */
async function refreshOnce (store, token, { fetchImpl = fetch, login = '' } = {}) {
  const existing = refreshing.get(store)
  if (existing !== undefined) return existing
  const pending = (async () => {
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
    const owners = store.accounts()
    const owner = login === '' ? null : owners.find((entry) => entry.login === login) || null
    if (login !== '' && owner === null) {
      throw new AuthError('the GitHub account disappeared while its token was refreshing', 'E_NOT_CONNECTED')
    }
    const account = owner !== null ? { login: owner.login, id: owner.id } : store.activeAccount()
    if (account === null) {
      throw new AuthError('no GitHub account is available to store the refreshed token', 'E_NOT_CONNECTED')
    }
    const parsed = parseScopes(refreshed.scope)
    const scopes = parsed.length > 0
      ? parsed
      : (owner !== null && Array.isArray(owner.scopes) ? owner.scopes : [])
    store.setToken(
      { ...refreshed, refreshToken: refreshed.refreshToken || token.refreshToken },
      account,
      scopes,
      { activate: false }
    )
    return { accessToken: refreshed.accessToken, login: account.login }
  })()
  refreshing.set(store, pending)
  try {
    return await pending
  } finally {
    if (refreshing.get(store) === pending) refreshing.delete(store)
  }
}

/**
 * Resolve a non-expired access token, refreshing it when possible.
 *
 * Every iteration re-reads the active token from the vault, so a concurrent
 * account switch or logout can never hand back an expired or foreign token.
 * @param {import('./vault').VaultStore} store
 * @param {{fetchImpl?: typeof fetch, now?: () => number}} [options]
 * @returns {Promise<string>}
 */
async function requireAccessToken (store, { fetchImpl = fetch, now = Date.now } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = store.token()
    if (token === null) {
      throw new AuthError('GitHub is not connected yet; run github_auth_start and finish the browser flow', 'E_NOT_CONNECTED')
    }
    const usable = token.accessToken !== '' &&
      (token.expiresAt === 0 || token.expiresAt - now() >= REFRESH_WINDOW_MS)
    if (usable) return token.accessToken
    if (token.refreshToken === '') {
      throw new AuthError('the GitHub access token has expired and no refresh token is stored; reconnect with github_auth_start', 'E_TOKEN_EXPIRED')
    }
    const inFlight = refreshing.get(store)
    if (inFlight !== undefined) {
      try { await inFlight } catch {}
      continue
    }
    await refreshOnce(store, token, { fetchImpl, login: store.activeLogin() })
  }
  const final = store.token()
  if (final !== null && final.accessToken !== '' &&
      (final.expiresAt === 0 || final.expiresAt - now() >= REFRESH_WINDOW_MS)) {
    return final.accessToken
  }
  throw new AuthError('could not obtain a fresh GitHub token; reconnect with github_auth_start', 'E_TOKEN_EXPIRED')
}

module.exports = { AuthError, completeAuthorization, requireAccessToken, REFRESH_WINDOW_MS }
