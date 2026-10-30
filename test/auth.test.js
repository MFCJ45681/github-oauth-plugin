'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { VaultStore } = require('../lib/vault')
const { requireAccessToken, REFRESH_WINDOW_MS } = require('../lib/auth')

function jsonResponse (body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

/** A vault with an almost-expired token and a refresh token. */
function expiredStore () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-auth-'))
  const store = new VaultStore({ dataDir })
  store.setToken(
    {
      accessToken: 'old-access',
      tokenType: 'bearer',
      scope: 'repo',
      refreshToken: 'old-refresh',
      expiresAt: Date.now() + Math.floor(REFRESH_WINDOW_MS / 2),
      refreshTokenExpiresAt: Date.now() + 6 * 30 * 24 * 3600 * 1000
    },
    { login: 'octocat', id: 1, name: 'The Octocat', avatarUrl: 'https://avatars.test/o.png' },
    ['repo']
  )
  return store
}

test('concurrent callers share one token refresh', async () => {
  const store = expiredStore()
  let tokenCalls = 0
  const fetchImpl = async (url) => {
    assert.match(String(url), /\/login\/oauth\/access_token$/)
    tokenCalls += 1
    // A slow exchange widens the window in which a second caller would refresh again.
    await new Promise((resolve) => setTimeout(resolve, 25))
    return jsonResponse({ access_token: 'new-access', token_type: 'bearer', scope: 'repo', refresh_token: 'new-refresh', expires_in: 28800 })
  }

  const results = await Promise.all([
    requireAccessToken(store, { fetchImpl }),
    requireAccessToken(store, { fetchImpl }),
    requireAccessToken(store, { fetchImpl })
  ])

  assert.deepEqual(results, ['new-access', 'new-access', 'new-access'])
  assert.equal(tokenCalls, 1, 'the refresh endpoint must be called exactly once')
  const token = store.token()
  assert.equal(token.accessToken, 'new-access')
  assert.equal(token.refreshToken, 'new-refresh')
  assert.equal(store.status().account.login, 'octocat')
})

test('a refresh updates only the active account', async () => {
  const store = expiredStore()
  store.setToken(
    { accessToken: 'hubot-access', expiresAt: Date.now() + 3600 * 1000 },
    { login: 'hubot', id: 2, name: 'Hubot' },
    ['repo']
  )
  assert.equal(store.activeLogin(), 'hubot')
  store.switchAccount('octocat')

  const calls = []
  const fetchImpl = async (url) => {
    calls.push(String(url))
    return jsonResponse({ access_token: 'new-access', token_type: 'bearer', scope: 'repo', refresh_token: 'new-refresh', expires_in: 28800 })
  }

  assert.equal(await requireAccessToken(store, { fetchImpl }), 'new-access')
  assert.equal(calls.length, 1)
  assert.equal(store.activeLogin(), 'octocat', 'refreshing must not switch the active account')
  assert.equal(store.token('octocat').accessToken, 'new-access')
  assert.equal(store.token('hubot').accessToken, 'hubot-access', 'the other account keeps its token')
})

test('a stored unexpired token is returned without any network call', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-auth-'))
  const store = new VaultStore({ dataDir })
  store.setToken({ accessToken: 'fresh-token', expiresAt: Date.now() + 3600 * 1000 }, { login: 'octocat' }, ['repo'])
  let calls = 0
  const fetchImpl = async () => {
    calls += 1
    return jsonResponse({})
  }
  assert.equal(await requireAccessToken(store, { fetchImpl }), 'fresh-token')
  assert.equal(calls, 0)
})

test('an expired token without a refresh token reports E_TOKEN_EXPIRED', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-auth-'))
  const store = new VaultStore({ dataDir })
  store.setToken({ accessToken: 'stale', expiresAt: Date.now() - 1000 }, { login: 'octocat' }, ['repo'])
  await assert.rejects(requireAccessToken(store, { fetchImpl: async () => jsonResponse({}) }), (error) => {
    assert.equal(error.code, 'E_TOKEN_EXPIRED')
    return true
  })
})
