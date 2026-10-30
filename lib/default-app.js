'use strict'

/**
 * Built-in (default) GitHub OAuth App shipped with the plugin.
 *
 * Why a built-in app: the web application flow needs both a client id and a
 * client secret, and asking every user to register an OAuth App first is the
 * single most common source of setup failures (wrong callback URL, wrong
 * secret, forgotten app). With a built-in pair the plugin works out of the box
 * and the user only clicks "使用 GitHub 登录".
 *
 * Security note: a client secret baked into a distributed plugin is, in
 * effect, public. That is acceptable here because (a) the secret is only ever
 * used by this local process when talking to github.com, (b) the resulting
 * access token is still scoped to, and approved by, the individual user who
 * completes the browser consent screen, and (c) GitHub OAuth Apps cannot be
 * used to impersonate a user without that user's explicit authorization. It
 * is NOT a secret in the "protects your account" sense — do not treat it as
 * one, and rotate it if it is ever abused.
 *
 * Override without touching the code by exporting
 * GITHUB_OAUTH_DEFAULT_CLIENT_ID / GITHUB_OAUTH_DEFAULT_CLIENT_SECRET, or
 * switch the vault to a custom app from the settings page / github_auth_setup.
 */

const DEFAULT_CLIENT_ID = 'Ov23li80U9STQlDW7Tui'
const DEFAULT_CLIENT_SECRET = 'e96223611e1410c750cb7e857b9a40756f0eee3d'

/**
 * Resolve the built-in app, letting the environment override either half.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {{clientId: string, clientSecret: string}}
 */
function defaultCredentials (env = process.env) {
  const id = typeof env.GITHUB_OAUTH_DEFAULT_CLIENT_ID === 'string'
    ? env.GITHUB_OAUTH_DEFAULT_CLIENT_ID.trim()
    : ''
  const secret = typeof env.GITHUB_OAUTH_DEFAULT_CLIENT_SECRET === 'string'
    ? env.GITHUB_OAUTH_DEFAULT_CLIENT_SECRET.trim()
    : ''
  return {
    clientId: id !== '' ? id : DEFAULT_CLIENT_ID,
    clientSecret: secret !== '' ? secret : DEFAULT_CLIENT_SECRET
  }
}

module.exports = { DEFAULT_CLIENT_ID, DEFAULT_CLIENT_SECRET, defaultCredentials }
