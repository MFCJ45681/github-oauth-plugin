'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const http = require('node:http')
const os = require('node:os')
const path = require('node:path')

const { VaultStore } = require('../lib/vault')
const { PendingStates } = require('../lib/state')
const { createRoutes, BASE, CALLBACK_PATH } = require('../lib/routes')
const { DEFAULT_CLIENT_ID } = require('../lib/default-app')

function jsonResponse (body, headers = {}, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers }
  })
}

/** Fake GitHub endpoints; records every request so tests can assert on headers. */
function stubGitHub () {
  const calls = []
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    if (String(url).includes('/login/oauth/access_token')) {
      return jsonResponse({ access_token: 'gho_test_token', token_type: 'bearer', scope: 'repo read:user' })
    }
    if (String(url).endsWith('/user')) {
      return jsonResponse(
        { login: 'octocat', id: 1, name: 'The Octocat', avatar_url: 'https://avatars.test/o.png' },
        { 'x-oauth-scopes': 'repo, read:user', 'x-ratelimit-remaining': '4999', 'x-ratelimit-reset': '1800000000' }
      )
    }
    if (String(url).includes('/user/repos')) {
      return jsonResponse([{
        full_name: 'octocat/Hello-World',
        description: 'My first repository',
        private: false,
        language: 'JavaScript',
        stargazers_count: 42,
        updated_at: '2024-05-01T00:00:00Z',
        html_url: 'https://github.test/octocat/Hello-World'
      }])
    }
    return jsonResponse({ message: 'unexpected request' }, {}, 404)
  }
  return { fetchImpl, calls }
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
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve))
  }
}

function cookieFrom (response) {
  const header = response.headers.getSetCookie ? response.headers.getSetCookie()[0] : response.headers.get('set-cookie')
  return header === null || header === undefined ? '' : header.split(';')[0]
}

function buildEnv () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-http-'))
  const store = new VaultStore({ dataDir })
  const states = new PendingStates()
  const github = stubGitHub()
  return { store, states, github }
}

test('status is reported before any configuration', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())

  const response = await fetch(`http://127.0.0.1:${server.port}${BASE}/status`)
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.status.configured, true)
  assert.equal(body.status.authSource, 'default')
  assert.equal(body.status.connected, false)
  assert.equal(body.status.clientIdMasked.endsWith('…ui'), true)
  assert.equal(JSON.stringify(body).includes('secret'), false)
})

test('start works out of the box with the built-in OAuth App', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())

  const response = await fetch(`http://127.0.0.1:${server.port}${BASE}/start`, { redirect: 'manual' })
  assert.equal(response.status, 302)
  const location = new URL(response.headers.get('location'))
  assert.equal(location.origin + location.pathname, 'https://github.com/login/oauth/authorize')
  assert.equal(location.searchParams.get('client_id'), DEFAULT_CLIENT_ID)
  assert.equal(location.searchParams.get('redirect_uri'), `http://127.0.0.1:${server.port}${CALLBACK_PATH}`)
  assert.ok((response.headers.get('set-cookie') || '').includes('gho_oauth_state='))
})

test('config rejects cross-origin writes and accepts same-origin ones', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.port}${BASE}/config`

  const cross = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
    body: JSON.stringify({ clientId: 'id-123456', clientSecret: 'secret-value' })
  })
  assert.equal(cross.status, 403)

  const same = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
    body: JSON.stringify({ clientId: 'id-123456', clientSecret: 'secret-value' })
  })
  assert.equal(same.status, 200)
  assert.equal(env.store.isConfigured(), true)
  const status = await (await fetch(`http://127.0.0.1:${server.port}${BASE}/status`)).json()
  assert.equal(status.status.clientIdMasked, 'id-123…56')
  assert.equal(status.status.authSource, 'custom')

  const back = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
    body: JSON.stringify({ mode: 'default' })
  })
  assert.equal(back.status, 200)
  const backBody = await back.json()
  assert.equal(backBody.status.authSource, 'default')
  assert.equal(backBody.status.hasCustomApp, true)
})

test('preferences are readable, same-origin writable and validated', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())
  const url = `http://127.0.0.1:${server.port}${BASE}/preferences`

  const empty = await (await fetch(url)).json()
  assert.equal(empty.preferences.defaultRepo, '')
  assert.deepEqual(empty.preferences.pinnedRepos, [])

  const cross = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
    body: JSON.stringify({ defaultRepo: 'octocat/Hello-World' })
  })
  assert.equal(cross.status, 403)

  const saved = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
    body: JSON.stringify({ defaultRepo: 'octocat/Hello-World', pinnedRepos: ['octocat/Hello-World'] })
  })
  assert.equal(saved.status, 200)
  const savedBody = await saved.json()
  assert.equal(savedBody.preferences.defaultRepo, 'octocat/Hello-World')
  assert.deepEqual(savedBody.preferences.pinnedRepos, ['octocat/Hello-World'])

  const invalid = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
    body: JSON.stringify({ defaultRepo: 'no-slash' })
  })
  assert.equal(invalid.status, 400)
  const invalidBody = await invalid.json()
  assert.equal(invalidBody.code, 'E_INPUT')

  const cleared = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${server.port}` },
    body: JSON.stringify({ defaultRepo: '', pinnedRepos: [] })
  })
  assert.equal(cleared.status, 200)
  const clearedBody = await cleared.json()
  assert.equal(clearedBody.preferences.defaultRepo, '')
  assert.deepEqual(clearedBody.preferences.pinnedRepos, [])
})

test('accounts can be listed, switched and removed over the same-origin API', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${server.port}`
  env.store.setToken({ accessToken: 'token-octocat' }, { login: 'octocat', name: 'The Octocat' }, ['repo'])
  env.store.setToken({ accessToken: 'token-hubot' }, { login: 'hubot', name: 'Hubot' }, ['repo', 'read:user'])

  const listed = await (await fetch(`${origin}${BASE}/accounts`)).json()
  assert.equal(listed.ok, true)
  assert.equal(listed.activeLogin, 'hubot')
  assert.deepEqual(listed.accounts.map((entry) => entry.login).sort(), ['hubot', 'octocat'])
  assert.equal(JSON.stringify(listed).includes('token-hubot'), false, 'the API never returns tokens')

  const cross = await fetch(`${origin}${BASE}/accounts/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.test' },
    body: JSON.stringify({ login: 'octocat' })
  })
  assert.equal(cross.status, 403)

  const switched = await fetch(`${origin}${BASE}/accounts/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ login: 'octocat' })
  })
  assert.equal(switched.status, 200)
  assert.equal((await switched.json()).status.activeLogin, 'octocat')

  const unknown = await fetch(`${origin}${BASE}/accounts/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ login: 'nobody' })
  })
  assert.equal(unknown.status, 404)
  assert.equal((await unknown.json()).code, 'E_NOT_FOUND')

  const missingLogin = await fetch(`${origin}${BASE}/accounts/switch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({})
  })
  assert.equal(missingLogin.status, 400)

  const removed = await fetch(`${origin}${BASE}/accounts/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ login: 'octocat' })
  })
  assert.equal(removed.status, 200)
  assert.equal((await removed.json()).status.activeLogin, 'hubot')

  const gone = await fetch(`${origin}${BASE}/accounts/remove`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ login: 'octocat' })
  })
  assert.equal(gone.status, 404)
})

test('the full browser flow connects an account and lists repositories', async (t) => {
  const env = buildEnv()
  env.store.configure({ clientId: 'id-123456', clientSecret: 'secret-value' })
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())
  const origin = `http://127.0.0.1:${server.port}`

  const start = await fetch(`${origin}${BASE}/start`, { redirect: 'manual' })
  assert.equal(start.status, 302)
  const location = start.headers.get('location')
  assert.ok(location.startsWith('https://github.com/login/oauth/authorize?'))
  const authorize = new URL(location)
  assert.equal(authorize.searchParams.get('client_id'), 'id-123456')
  assert.equal(authorize.searchParams.get('redirect_uri'), `${origin}${CALLBACK_PATH}`)
  const state = authorize.searchParams.get('state')
  assert.ok(state)
  const cookie = cookieFrom(start)
  assert.match(cookie, /^gho_oauth_state=/)

  const badCookie = await fetch(`${origin}${CALLBACK_PATH}?code=abc&state=${encodeURIComponent(state)}`, { redirect: 'manual' })
  assert.equal(badCookie.status, 400)
  assert.match(await badCookie.text(), /state 校验失败/)

  // A fresh start: the previous state was consumed by the rejected callback.
  const start2 = await fetch(`${origin}${BASE}/start`, { redirect: 'manual' })
  const state2 = new URL(start2.headers.get('location')).searchParams.get('state')
  const cookie2 = cookieFrom(start2)
  const callback = await fetch(`${origin}${CALLBACK_PATH}?code=the-code&state=${encodeURIComponent(state2)}`, {
    headers: { cookie: cookie2 },
    redirect: 'manual'
  })
  assert.equal(callback.status, 200)
  assert.match(await callback.text(), /GitHub 已连接/)

  const status = await (await fetch(`${origin}${BASE}/status`)).json()
  assert.equal(status.status.connected, true)
  assert.equal(status.status.account.login, 'octocat')
  assert.deepEqual(status.status.scopes, ['repo', 'read:user'])

  const repos = await (await fetch(`${origin}${BASE}/repos?limit=5`)).json()
  assert.equal(repos.ok, true)
  assert.equal(repos.repos[0].fullName, 'octocat/Hello-World')
  assert.equal(repos.repos[0].stars, 42)

  const tokenCall = env.github.calls.find((call) => call.url.includes('access_token'))
  assert.equal(tokenCall.init.method, 'POST')
  assert.match(tokenCall.init.body, /code=the-code/)

  const logout = await fetch(`${origin}${BASE}/logout`, {
    method: 'POST',
    headers: { origin }
  })
  assert.equal(logout.status, 200)
  assert.equal((await logout.json()).status.connected, false)
})

test('a cancelled authorization renders an error page and clears the cookie', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())
  const response = await fetch(
    `http://127.0.0.1:${server.port}${CALLBACK_PATH}?error=access_denied&error_description=denied+by+user`,
    { redirect: 'manual' }
  )
  assert.equal(response.status, 400)
  assert.match(await response.text(), /授权被取消/)
  assert.match(cookieFrom(response), /^gho_oauth_state=$/)
})

test('bootstrap returns status, preferences and repositories in one cached response', async (t) => {
  const env = buildEnv()
  env.store.setPreferences({ defaultRepo: 'octocat/Hello-World' })
  env.store.setToken({ accessToken: 'gho_test_token', scope: 'repo' }, { login: 'octocat' }, ['repo'])
  const cache = new Map()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl, cache })
  const server = await serve(routes)
  t.after(() => server.close())

  const first = await fetch(`http://127.0.0.1:${server.port}${BASE}/bootstrap`)
  assert.equal(first.status, 200)
  const body = await first.json()
  assert.equal(body.ok, true)
  assert.equal(body.status.connected, true)
  assert.equal(body.status.account.login, 'octocat')
  assert.equal(body.preferences.defaultRepo, 'octocat/Hello-World')
  assert.equal(body.repos.length, 1)
  assert.equal(body.repos[0].fullName, 'octocat/Hello-World')
  assert.equal(body.repos[0].stars, 42)

  const repoCalls = () => env.github.calls.filter((call) => call.url.includes('/user/repos')).length
  const before = repoCalls()
  const second = await fetch(`http://127.0.0.1:${server.port}${BASE}/bootstrap`)
  assert.equal(second.status, 200)
  assert.equal(repoCalls(), before, 'the second bootstrap is served from the shared cache')
})

test('bootstrap reports an empty repository list while disconnected', async (t) => {
  const env = buildEnv()
  const { routes } = createRoutes({ store: env.store, states: env.states, fetchImpl: env.github.fetchImpl })
  const server = await serve(routes)
  t.after(() => server.close())

  const response = await fetch(`http://127.0.0.1:${server.port}${BASE}/bootstrap`)
  const body = await response.json()
  assert.equal(body.status.connected, false)
  assert.deepEqual(body.repos, [])
  assert.equal(env.github.calls.some((call) => call.url.includes('/user/repos')), false)
})
