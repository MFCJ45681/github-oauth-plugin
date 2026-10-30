#!/usr/bin/env node
'use strict'

/**
 * Micro-benchmarks for the hot paths of the plugin. Runs entirely offline:
 * the vault uses a throwaway data directory and GitHub API calls are served by
 * an in-process stub, so the numbers reflect plugin overhead rather than the
 * network.
 *
 *   npm run bench              # default iteration counts
 *   npm run bench -- --json    # machine-readable output
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { VaultStore } = require('../lib/vault.js')
const { buildTools } = require('../lib/tools.js')
const { PendingStates } = require('../lib/state.js')

const json = process.argv.includes('--json')
const iterations = (() => {
  const index = process.argv.indexOf('--iterations')
  if (index === -1) return 300
  const value = Number(process.argv[index + 1])
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 300
})()

function jsonResponse(body, init) {
  const status = (init && init.status) || 200
  const headers = new Map(Object.entries((init && init.headers) || {}))
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    url: 'http://bench.invalid/',
    headers: { get: (name) => headers.get(String(name).toLowerCase()) || null },
    text: () => Promise.resolve(JSON.stringify(body)),
    json: () => Promise.resolve(body)
  })
}

const stubFetch = async (url) => {
  const target = new URL(String(url))
  if (target.pathname === '/repos/o/r') {
    return jsonResponse({
      full_name: 'o/r',
      default_branch: 'main',
      description: 'bench repo',
      stargazers_count: 7,
      html_url: 'https://github.com/o/r',
      private: false,
      language: 'JavaScript',
      owner: { login: 'o' }
    })
  }
  if (target.pathname === '/repos/o/r/readme') {
    return jsonResponse({
      name: 'README.md',
      path: 'README.md',
      encoding: 'base64',
      content: Buffer.from('# bench\n\nA benchmark fixture.\n').toString('base64')
    })
  }
  if (target.pathname === '/repos/o/r/contents/') {
    return jsonResponse([
      { name: 'lib', path: 'lib', type: 'dir' },
      { name: 'index.js', path: 'index.js', type: 'file', size: 42 },
      { name: 'README.md', path: 'README.md', type: 'file', size: 22 }
    ])
  }
  return jsonResponse({ message: 'not found' }, { status: 404 })
}

async function measure(label, fn) {
  for (let index = 0; index < 10; index += 1) await fn()
  const started = process.hrtime.bigint()
  for (let index = 0; index < iterations; index += 1) await fn()
  const elapsedNs = Number(process.hrtime.bigint() - started)
  const perOpMs = elapsedNs / 1e6 / iterations
  const opsPerSecond = iterations / (elapsedNs / 1e9)
  return { label, iterations, perOpMs, opsPerSecond }
}

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-bench-'))
  process.env.GITHUB_OAUTH_DATA_DIR = dataDir
  const store = new VaultStore()
  const cleanup = () => fs.rmSync(dataDir, { recursive: true, force: true })

  try {
    store.configure({ mode: 'custom', clientId: 'Iv1.bench', clientSecret: 'a'.repeat(40) })
    const expiresAt = Date.now() + 6 * 60 * 60 * 1000
    store.setToken(
      { accessToken: 'bench-token', tokenType: 'bearer', expiresAt },
      { login: 'bench', id: 1, name: 'Bench' },
      ['repo', 'read:user']
    )
    store.setToken(
      { accessToken: 'bench-token-2', tokenType: 'bearer', expiresAt },
      { login: 'bench-two', id: 2, name: 'Bench Two' },
      ['repo']
    )
    store.switchAccount('bench')

    const tools = buildTools({
      defineTool: (definition) => definition,
      store,
      states: new PendingStates(),
      fetchImpl: stubFetch,
      port: () => 3080
    })
    const repo = tools.find((tool) => tool.name === 'github_repo')
    const pref = tools.find((tool) => tool.name === 'github_preferences')
    const results = []
    results.push(await measure('vault.status()', () => Promise.resolve(store.status())))
    results.push(await measure('vault.token()', () => Promise.resolve(store.token())))
    results.push(await measure('vault.accounts()', () => Promise.resolve(store.accounts())))
    results.push(await measure('vault.preferences()', () => Promise.resolve(store.preferences())))
    results.push(await measure('github_repo (cold cache miss)', () => repo.execute({ repo: 'o/r', withContext: false }, {})))
    results.push(await measure('github_repo (GET cache hit)', () => repo.execute({ repo: 'o/r', withContext: false }, {})))
    results.push(await measure('github_repo + repo context', () => repo.execute({ repo: 'o/r', withContext: true }, {})))
    results.push(await measure('github_preferences (read)', () => pref.execute({}, {})))

    if (json) {
      process.stdout.write(JSON.stringify(results, null, 2) + '\n')
    } else {
      const width = Math.max(...results.map((item) => item.label.length))
      for (const item of results) {
        const label = item.label.padEnd(width)
        const perOp = item.perOpMs.toFixed(3).padStart(8)
        const ops = Math.round(item.opsPerSecond).toString().padStart(7)
        process.stdout.write(`${label}  ${perOp} ms/op  ${ops} ops/s\n`)
      }
    }
  } finally {
    cleanup()
  }
}

main().catch((error) => {
  process.stderr.write(`bench failed: ${error && error.message ? error.message : error}\n`)
  process.exitCode = 1
})
