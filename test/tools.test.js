'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { VaultStore } = require('../plugin/lib/vault')
const { PendingStates } = require('../plugin/lib/state')
const { buildTools } = require('../plugin/lib/tools')
const { DEFAULT_CLIENT_ID } = require('../plugin/lib/default-app')

const REPO = {
  full_name: 'octocat/Hello-World',
  description: 'My first repository',
  private: false,
  fork: false,
  archived: false,
  default_branch: 'main',
  language: 'JavaScript',
  stargazers_count: 42,
  forks_count: 7,
  open_issues_count: 3,
  subscribers_count: 5,
  topics: ['demo'],
  license: { spdx_id: 'MIT' },
  updated_at: '2024-05-01T00:00:00Z',
  pushed_at: '2024-04-30T00:00:00Z',
  html_url: 'https://github.test/octocat/Hello-World'
}

function jsonResponse (body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function fakeFetch () {
  return async (url) => {
    const target = String(url)
    if (target.includes('/repos/octocat/Hello-World/issues')) {
      return jsonResponse([
        { number: 1, title: 'A real issue', state: 'open', user: { login: 'octocat' }, labels: [{ name: 'bug' }], html_url: 'https://github.test/issues/1', created_at: '2024-05-01T00:00:00Z', comments: 0, body: 'hello' },
        { number: 2, title: 'A pull request', state: 'open', user: { login: 'octocat' }, labels: [], html_url: 'https://github.test/pull/2', pull_request: { url: 'x' } }
      ])
    }
    if (target.includes('/repos/octocat/Hello-World')) return jsonResponse(REPO)
    if (target.includes('/user/repos')) return jsonResponse([])
    return jsonResponse({ message: 'Not Found', documentation_url: 'https://docs.github.test' }, 404)
  }
}

function makeEnv () {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-tools-'))
  const store = new VaultStore({ dataDir })
  const states = new PendingStates()
  const tools = Object.fromEntries(
    buildTools({ defineTool: (options) => options, store, states, fetchImpl: fakeFetch(), port: () => 3080 })
      .map((tool) => [tool.name, tool])
  )
  return { store, states, tools }
}

test('registers the full github_* tool surface', () => {
  const { tools } = makeEnv()
  assert.deepEqual(Object.keys(tools).sort(), [
    'github_api_request', 'github_auth_logout', 'github_auth_setup', 'github_auth_start', 'github_auth_status',
    'github_create_issue', 'github_file', 'github_issues', 'github_preferences', 'github_pulls', 'github_repo', 'github_search'
  ])
})

test('auth tools work out of the box with the built-in OAuth App', async () => {
  const { tools, store } = makeEnv()
  const status = await tools.github_auth_status.execute({}, {})
  assert.equal(status.ok, true)
  assert.equal(status.data.configured, true)
  assert.equal(status.data.authSource, 'default')
  assert.match(status.text, /内置默认/)
  assert.equal(status.text.includes(DEFAULT_CLIENT_ID), false)

  const start = await tools.github_auth_start.execute({}, {})
  assert.equal(start.ok, true)
  assert.match(start.data.authorizeUrl, new RegExp(`client_id=${DEFAULT_CLIENT_ID}`))

  const setup = await tools.github_auth_setup.execute({ clientId: 'id-123456' }, {})
  assert.equal(setup.ok, false)
  assert.match(setup.text, /clientSecret/)
  assert.equal(store.credentials().source, 'default')
})

test('auth setup stores credentials and start returns an authorize URL', async () => {
  const { tools, store, states } = makeEnv()
  const setup = await tools.github_auth_setup.execute({ clientId: 'id-123456', clientSecret: 'secret-value' }, {})
  assert.equal(setup.ok, true)
  assert.equal(store.credentials().clientSecret, 'secret-value')

  const start = await tools.github_auth_start.execute({ publicUrl: 'http://192.168.1.10:3080/' }, {})
  assert.equal(start.ok, true)
  assert.match(start.data.authorizeUrl, /client_id=id-123456/)
  assert.equal(start.data.redirectUri, 'http://192.168.1.10:3080/plugins/github-oauth/callback')
  assert.equal(states.size, 1)
  assert.equal(start.text.includes('secret-value'), false)

  const logout = await tools.github_auth_logout.execute({}, {})
  assert.equal(logout.ok, true)
  assert.equal(store.isConfigured(), true)

  const back = await tools.github_auth_setup.execute({ useDefault: true }, {})
  assert.equal(back.ok, true)
  assert.match(back.text, /内置默认/)
  assert.equal(store.credentials().source, 'default')
  assert.equal(store.status().hasCustomApp, true)
})

test('repository tools report a clear failure before login', async () => {
  const { tools } = makeEnv()
  const repo = await tools.github_repo.execute({ repo: 'octocat/Hello-World' }, {})
  assert.equal(repo.ok, false)
  assert.equal(repo.code, 'E_NOT_CONNECTED')
  assert.match(repo.text, /github_auth_start/)

  const badRepo = await tools.github_repo.execute({ repo: 'no-slash' }, {})
  assert.equal(badRepo.ok, false)
})

test('repository tools read real payloads once connected', async () => {
  const { tools, store } = makeEnv()
  store.configure({ clientId: 'id-123456', clientSecret: 'secret-value' })
  store.setToken({ accessToken: 'gho_test', scope: 'repo' }, { login: 'octocat' }, ['repo'])

  const repo = await tools.github_repo.execute({ repo: 'octocat/Hello-World' }, {})
  assert.equal(repo.ok, true)
  assert.equal(repo.code, 'OK')
  assert.equal(repo.data.stars, 42)
  assert.equal(repo.data.defaultBranch, 'main')
  assert.match(repo.text, /★ 42/)

  const issues = await tools.github_issues.execute({ repo: 'octocat/Hello-World', limit: 10 }, {})
  assert.equal(issues.ok, true)
  assert.equal(issues.data.length, 1, 'pull requests are filtered out')
  assert.equal(issues.data[0].title, 'A real issue')
})

test('the default repository fills a missing repo argument', async () => {
  const { tools, store } = makeEnv()
  store.configure({ clientId: 'id-123456', clientSecret: 'secret-value' })
  store.setToken({ accessToken: 'gho_test', scope: 'repo' }, { login: 'octocat' }, ['repo'])

  const unset = await tools.github_repo.execute({}, {})
  assert.equal(unset.ok, false)
  assert.equal(unset.code, 'E_NO_REPO')
  assert.match(unset.text, /默认仓库/)

  const saved = await tools.github_preferences.execute({ defaultRepo: 'octocat/Hello-World' }, {})
  assert.equal(saved.ok, true)
  assert.equal(saved.data.defaultRepo, 'octocat/Hello-World')

  const repo = await tools.github_repo.execute({}, {})
  assert.equal(repo.ok, true)
  assert.equal(repo.data.stars, 42, 'the request went to the default repository')

  const read = await tools.github_preferences.execute({}, {})
  assert.equal(read.data.defaultRepo, 'octocat/Hello-World')

  const cleared = await tools.github_preferences.execute({ defaultRepo: '' }, {})
  assert.equal(cleared.ok, true)
  assert.equal(cleared.data.defaultRepo, '')

  const invalid = await tools.github_preferences.execute({ defaultRepo: 'no-slash' }, {})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.code, 'E_INPUT')
})

test('github_api_request returns ok:false for non-2xx without throwing', async () => {
  const { tools, store } = makeEnv()
  store.configure({ clientId: 'id-123456', clientSecret: 'secret-value' })
  store.setToken({ accessToken: 'gho_test', scope: 'repo' }, { login: 'octocat' }, ['repo'])

  const missing = await tools.github_api_request.execute({ path: '/repos/missing/missing' }, {})
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'E_GITHUB')
  assert.equal(missing.status, 404)
  assert.match(missing.text, /Not Found/)
})

test('every tool renders text content blocks', () => {
  const { tools } = makeEnv()
  for (const tool of Object.values(tools)) {
    const blocks = tool.output.render({}, { ok: true, code: 'OK', text: 'hello' })
    assert.equal(blocks[0].type, 'text')
    assert.equal(blocks[0].text, 'hello')
  }
})
