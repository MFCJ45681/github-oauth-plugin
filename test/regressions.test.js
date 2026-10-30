'use strict'

/**
 * Regression tests for the 1.0 audit: account-scoped caches, refresh identity,
 * CSRF method checks, truncated payloads, path traversal and single-use state.
 */

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const { VaultStore, VaultError } = require('../lib/vault')
const { PendingStates } = require('../lib/state')
const { buildTools } = require('../lib/tools')
const { createRoutes, BASE, CALLBACK_PATH } = require('../lib/routes')
const { requireAccessToken } = require('../lib/auth')
const { randomToken } = require('../lib/crypto')

function jsonResponse (body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

function makeStore () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-reg-'))
  return new VaultStore({ dataDir })
}

function makeTools (store, fetchImpl, cache) {
  const states = new PendingStates()
  const tools = Object.fromEntries(
    buildTools({ defineTool: (options) => options, store, states, fetchImpl, port: () => 3080, cache: cache || new Map() })
      .map((tool) => [tool.name, tool])
  )
  return { tools, states }
}

async function serve (routes) {
  const table = new Map(routes.map((route) => [route.path, route.handler]))
  const server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url || '/', 'http://placeholder')
    const handler = table.get(pathname)
    if (handler === undefined) {
      res.writeHead(404, { 'content-type': 'text/plain' })
      res.end('not found')
      return
    }
    Promise.resolve(handler(req, res)).catch((error) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'text/plain' })
        res.end(String(error))
      }
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) }
}

function cookieFrom (response) {
  const header = response.headers.getSetCookie ? response.headers.getSetCookie()[0] : response.headers.get('set-cookie')
  return header === null || header === undefined ? '' : header.split(';')[0]
}

test('GET responses are scoped to the token that produced them', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'token-a' }, { login: 'octocat' }, ['repo'])
  store.setToken({ accessToken: 'token-b' }, { login: 'hubot' }, ['repo'])
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push(String(url))
    const auth = init.headers && init.headers.authorization
    const owner = auth === 'Bearer token-b' ? 'hubot/Secret' : 'octocat/Hello-World'
    if (String(url).includes('/repos/')) {
      return jsonResponse({ full_name: owner, stargazers_count: 1, default_branch: 'main' })
    }
    return jsonResponse({ message: 'unexpected' }, {}, 404)
  }
  const cache = new Map()
  store.switchAccount('octocat')
  const { tools } = makeTools(store, fetchImpl, cache)

  const first = await tools.github_repo.execute({ repo: 'octocat/Hello-World', withContext: false }, {})
  assert.equal(first.ok, true)
  assert.equal(first.data.fullName, 'octocat/Hello-World')

  // Switch without clearing the cache: the key must include the token scope.
  store.switchAccount('hubot')
  const second = await tools.github_repo.execute({ repo: 'hubot/Secret', withContext: false }, {})
  assert.equal(second.ok, true)
  assert.equal(second.data.fullName, 'hubot/Secret')
  assert.equal(calls.length, 2, 'the second account must not reuse the first account cache entry')
})

test('a refresh lands on the account that owned the token', async () => {
  const store = makeStore()
  const past = Date.now() - 1000
  store.setToken({ accessToken: 'A_OLD', refreshToken: 'RA', expiresAt: past }, { login: 'alice' }, ['repo', 'read:user'])
  store.setToken({ accessToken: 'B_OK', expiresAt: Date.now() + 3600 * 1000 }, { login: 'bob' }, ['repo'])
  store.switchAccount('alice')

  let release
  const gate = new Promise((resolve) => { release = resolve })
  const fetchImpl = async (url) => {
    if (String(url).includes('/login/oauth/access_token')) {
      await gate
      return jsonResponse({ access_token: 'A_NEW', token_type: 'bearer', scope: '', refresh_token: 'RA2', expires_in: 28800 })
    }
    return jsonResponse({ message: 'unexpected' }, {}, 404)
  }

  const pending = requireAccessToken(store, { fetchImpl })
  await new Promise((resolve) => setTimeout(resolve, 20))
  store.switchAccount('bob')
  release()
  const token = await pending

  assert.equal(token, 'B_OK', 'the caller gets the newly active account token')
  assert.equal(store.token('alice').accessToken, 'A_NEW')
  const alice = store.accounts().find((entry) => entry.login === 'alice')
  assert.deepEqual(alice.scopes, ['repo', 'read:user'], 'scopes survive a refresh that reports none')
  assert.equal(store.token('bob').accessToken, 'B_OK')
  assert.equal(store.activeLogin(), 'bob')
})

test('truncated responses fail loudly instead of looking empty', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const big = 'x'.repeat(300 * 1024)
  const fetchImpl = async () => jsonResponse({ items: [big] })
  const { tools } = makeTools(store, fetchImpl)
  const result = await tools.github_api_request.execute({ path: '/user/repos' }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_TRUNCATED')
})

test('a 404 with an exhausted quota is not reported as a rate limit', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const fetchImpl = async () => jsonResponse({ message: 'Not Found' }, { 'x-ratelimit-remaining': '0' }, 404)
  const { tools } = makeTools(store, fetchImpl)
  const result = await tools.github_repo.execute({ repo: 'octocat/Missing', withContext: false }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_GITHUB')
})

test('a GET request with a body is rejected as input', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const { tools } = makeTools(store, async () => jsonResponse({}))
  const result = await tools.github_api_request.execute({ method: 'GET', path: '/user', body: { a: 1 } }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_INPUT')
})

test('github_file rejects paths that escape the repository', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const { tools } = makeTools(store, async () => jsonResponse({ type: 'file', encoding: 'base64', content: 'aGk=' }))
  for (const filePath of ['../../user', 'a/../../b', 'a//b', './a']) {
    const result = await tools.github_file.execute({ repo: 'octocat/Hello-World', path: filePath }, {})
    assert.equal(result.ok, false, filePath)
    assert.equal(result.code, 'E_INPUT', filePath)
  }
})

test('github_file reports large files that the contents API truncates', async () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const fetchImpl = async () => jsonResponse({ type: 'file', encoding: 'none', content: '', size: 2 * 1024 * 1024 })
  const { tools } = makeTools(store, fetchImpl)
  const result = await tools.github_file.execute({ repo: 'octocat/Hello-World', path: 'big.bin' }, {})
  assert.equal(result.ok, false)
  assert.equal(result.code, 'E_FILE_TOO_LARGE')
})

test('logout refuses GET so a web page cannot erase tokens', async (t) => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  const { routes } = createRoutes({ store, states: new PendingStates(), fetchImpl: async () => jsonResponse({}) })
  const server = await serve(routes)
  t.after(() => server.close())

  const response = await fetch(`http://127.0.0.1:${server.port}${BASE}/logout`)
  assert.equal(response.status, 405)
  assert.equal(store.status().connected, true)

  const posted = await fetch(`http://127.0.0.1:${server.port}${BASE}/logout`, { method: 'POST' })
  assert.equal(posted.status, 200)
  assert.equal(store.status().connected, false)
})

test('a malformed state cookie renders the result page, not a 500', async (t) => {
  const store = makeStore()
  const states = new PendingStates()
  const pending = states.create({ redirectUri: 'http://127.0.0.1/x', scope: 'repo', browserBound: true })
  const { routes } = createRoutes({ store, states, fetchImpl: async () => jsonResponse({}) })
  const server = await serve(routes)
  t.after(() => server.close())

  const response = await fetch(
    `http://127.0.0.1:${server.port}${CALLBACK_PATH}?code=abc&state=${encodeURIComponent(pending.state)}`,
    { headers: { cookie: 'gho_oauth_state=%zz' } }
  )
  assert.equal(response.status, 400)
  assert.match(response.headers.get('content-type') || '', /text\/html/)
})

test('a failed token exchange keeps the state usable for one retry', async (t) => {
  const store = makeStore()
  const states = new PendingStates()
  let attempts = 0
  const fetchImpl = async (url) => {
    if (String(url).includes('/login/oauth/access_token')) {
      attempts += 1
      if (attempts === 1) return jsonResponse({ error: 'temporarily_unavailable' }, {}, 503)
      return jsonResponse({ access_token: 'gho_test', token_type: 'bearer', scope: 'repo' })
    }
    if (String(url).endsWith('/user')) return jsonResponse({ login: 'octocat', id: 1 }, { 'x-oauth-scopes': 'repo' })
    return jsonResponse({ message: 'unexpected' }, {}, 404)
  }
  const { routes } = createRoutes({ store, states, fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())

  const start = await fetch(`http://127.0.0.1:${server.port}${BASE}/start`, { redirect: 'manual' })
  const cookie = cookieFrom(start)
  const location = new URL(start.headers.get('location'))
  const state = location.searchParams.get('state')
  const callbackUrl = `http://127.0.0.1:${server.port}${CALLBACK_PATH}?code=abc&state=${encodeURIComponent(state)}`

  const first = await fetch(callbackUrl, { headers: { cookie } })
  assert.equal(first.status, 400)
  assert.equal(store.status().connected, false)

  const second = await fetch(callbackUrl, { headers: { cookie } })
  assert.equal(second.status, 200)
  assert.equal(store.status().connected, true)
  assert.equal(store.activeLogin(), 'octocat')
})

test('removing an unknown account reports E_NOT_FOUND', () => {
  const store = makeStore()
  store.setToken({ accessToken: 'gho_test' }, { login: 'octocat' }, ['repo'])
  assert.throws(() => store.removeAccount('nobody'), (error) => {
    assert.equal(error instanceof VaultError, true)
    assert.equal(error.code, 'E_NOT_FOUND')
    return true
  })
  assert.equal(store.status().connected, true)
})

test('randomToken honours a shorter byte length', () => {
  const token = randomToken(16)
  assert.equal(Buffer.from(token, 'base64url').length, 16)
  assert.equal(randomToken().length > 40, true)
})
