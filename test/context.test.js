'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { buildContext, loadRepoContext, createRepoContextCache } = require('../lib/context')
const { GitHubApi } = require('../lib/github-api')

const REPO = {
  full_name: 'octocat/Hello-World',
  description: 'My first repository',
  default_branch: 'main',
  language: 'JavaScript',
  stargazers_count: 42,
  topics: ['demo', 'octocat']
}

const README = Buffer.from('# Hello-World\n\nThis is the readme body.\n', 'utf8').toString('base64')
const CONTENTS = [
  { name: 'README.md', type: 'file', size: 34 },
  { name: 'src', type: 'dir', size: 0 },
  { name: 'index.js', type: 'file', size: 120 }
]

function jsonResponse (body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function stubApi (options = {}) {
  const calls = []
  const fetchImpl = async (url) => {
    const target = String(url)
    calls.push(target)
    if (options.failRepo === true && /\/repos\/octocat\/Hello-World$/.test(target)) {
      return jsonResponse({ message: 'Not Found' }, 404)
    }
    if (target.endsWith('/readme')) {
      return options.noReadme === true ? jsonResponse({ message: 'Not Found' }, 404) : jsonResponse({ content: README, encoding: 'base64' })
    }
    if (target.endsWith('/contents/')) return jsonResponse(CONTENTS)
    return jsonResponse(REPO)
  }
  return { api: new GitHubApi({ accessToken: 'token', fetchImpl }), calls }
}

test('buildContext renders metadata, a tree and a README excerpt', () => {
  const context = buildContext('octocat/Hello-World', REPO, { content: README, encoding: 'base64' }, CONTENTS, { readmeChars: 400 })
  assert.match(context.text, /仓库上下文 octocat\/Hello-World（默认分支 main）/)
  assert.match(context.text, /My first repository/)
  assert.match(context.text, /JavaScript · ★ 42 · topics: demo, octocat/)
  // directories sort before files
  assert.match(context.text, /顶层（3 项）：src\/ · index\.js · README\.md/)
  assert.match(context.text, /README 摘要：\n# Hello-World/)
  assert.equal(context.data.entries.length, 3)
  assert.equal(context.data.readmeTruncated, false)
})

test('buildContext survives a missing README and empty tree', () => {
  const context = buildContext('octocat/Hello-World', REPO, null, null, {})
  assert.match(context.text, /README：无/)
  assert.match(context.text, /顶层：无法读取/)
})

test('loadRepoContext fetches once and then serves the cached snapshot', async () => {
  const { api, calls } = stubApi()
  const cache = createRepoContextCache()
  const first = await loadRepoContext(api, 'octocat/Hello-World', { cache })
  assert.equal(calls.length, 3)
  assert.match(first.text, /README 摘要/)

  const second = await loadRepoContext(api, 'octocat/Hello-World', { cache })
  assert.equal(calls.length, 3, 'the second call must not hit GitHub again')
  assert.equal(second.text, first.text)
})

test('loadRepoContext rejects malformed names and reports HTTP failures', async () => {
  const { api } = stubApi({ failRepo: true })
  assert.equal(createRepoContextCache() instanceof Map, true)
  await assert.rejects(loadRepoContext(api, 'not-a-repo', {}), (error) => {
    assert.equal(error.code, 'E_INPUT')
    return true
  })
  await assert.rejects(loadRepoContext(api, 'octocat/Hello-World', {}), (error) => {
    assert.equal(error.code, 'E_NOT_FOUND')
    return true
  })
})

test('loadRepoContext treats a missing README as optional', async () => {
  const { api } = stubApi({ noReadme: true })
  const context = await loadRepoContext(api, 'octocat/Hello-World', {})
  assert.match(context.text, /README：无/)
  assert.match(context.text, /src\//)
})
