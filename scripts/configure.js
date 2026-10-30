#!/usr/bin/env node
'use strict'

/**
 * Out-of-band configuration helper for @local/github-oauth.
 *
 * The panel and the github_auth_setup tool cover the normal path; this script
 * exists for headless setups (SSH, containers) and for scripting, e.g.
 * piping the client secret from a secret manager so it never lands in shell
 * history or in the conversation.
 *
 *   node scripts/configure.js status
 *   node scripts/configure.js use-default          # built-in OAuth App (recommended)
 *   node scripts/configure.js set --client-id <id> --client-secret-stdin
 *   node scripts/configure.js set --client-id <id> --client-secret <secret>
 *   node scripts/configure.js logout
 *
 * Options: --data-dir <dir> overrides GITHUB_OAUTH_DATA_DIR.
 */

const fs = require('node:fs')
const path = require('node:path')

const { VaultStore, resolveDataDir } = require('../lib/vault')

/** @param {string[]} argv */
function parseArgs (argv) {
  const flags = {}
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (!arg.startsWith('--')) {
      rest.push(arg)
      continue
    }
    const name = arg.slice(2)
    if (name === 'client-secret-stdin' || name === 'json' || name === 'help' ||
        name === 'default' || name === 'reuse-custom') {
      flags[name] = true
      continue
    }
    const value = argv[index + 1]
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`--${name} 需要一个值`)
    }
    flags[name] = value
    index += 1
  }
  return { command: rest[0] || 'status', flags }
}

/** @param {string} label @param {unknown} value @param {boolean} asJson */
function emit (label, value, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return
  }
  process.stdout.write(`${label}\n`)
}

function printStatus (status, asJson, dataDir) {
  if (asJson) {
    emit('', { ...status, dataDir }, true)
    return
  }
  const lines = [
    `数据目录：${dataDir}`,
    status.authSource === 'default'
      ? `OAuth App：内置默认应用（client_id ${status.clientIdMasked}）`
      : `OAuth App：自定义应用（client_id ${status.clientIdMasked}）`,
    status.authSource === 'default' && status.hasCustomApp
      ? `另有已保存的自定义应用（client_id ${status.customClientIdMasked}），可用 set --reuse-custom 切回`
      : '',
    status.connected
      ? `GitHub 账号：@${status.account.login}${status.account.name ? ` (${status.account.name})` : ''}`
      : 'GitHub 账号：未连接',
    status.connected ? `授权范围：${status.scopes.join(', ') || '(未报告)'}` : '',
    status.connected && status.tokenExpiresAt ? `令牌过期：${status.tokenExpiresAt}（可刷新：${status.canRefresh ? '是' : '否'}）` : '',
    `加密 vault：${status.vault.path}（${status.vault.algorithm}，密钥来源 ${status.vault.keySource}）`
  ].filter(Boolean)
  process.stdout.write(`${lines.join('\n')}\n`)
}

async function readSecret (flags) {
  if (typeof flags['client-secret'] === 'string') return flags['client-secret'].trim()
  if (flags['client-secret-stdin'] === true) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8').trim()
  }
  if (typeof process.env.GITHUB_OAUTH_CLIENT_SECRET === 'string') {
    return process.env.GITHUB_OAUTH_CLIENT_SECRET.trim()
  }
  return ''
}

async function main () {
  const { command, flags } = parseArgs(process.argv.slice(2))
  if (flags.help === true || command === 'help') {
    process.stdout.write(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#!.*\n/, ''))
    return
  }
  const dataDir = typeof flags['data-dir'] === 'string' ? path.resolve(flags['data-dir']) : resolveDataDir()
  const asJson = flags.json === true
  const store = new VaultStore({ dataDir })

  if (command === 'status') {
    printStatus(store.status(), asJson, dataDir)
    return
  }

  if (command === 'logout') {
    store.clearToken()
    printStatus(store.status(), asJson, dataDir)
    return
  }

  if (command === 'use-default' || (command === 'set' && flags.default === true)) {
    const status = store.configure({ mode: 'default' })
    if (!asJson) process.stdout.write('已切换到内置默认 OAuth App。\n')
    printStatus(status, asJson, dataDir)
    return
  }

  if (command === 'set' || command === 'configure') {
    if (flags['reuse-custom'] === true) {
      const status = store.configure({ mode: 'custom' })
      if (!asJson) process.stdout.write('已切回已保存的自定义 OAuth App。\n')
      printStatus(status, asJson, dataDir)
      return
    }
    const clientId = typeof flags['client-id'] === 'string' ? flags['client-id'].trim() : ''
    if (clientId === '') throw new Error('缺少 --client-id（或用 use-default 使用内置默认应用）')
    const clientSecret = await readSecret(flags)
    if (clientSecret === '') {
      throw new Error('缺少 client secret：用 --client-secret、--client-secret-stdin 或 GITHUB_OAUTH_CLIENT_SECRET')
    }
    const status = store.configure({ clientId, clientSecret, mode: 'custom' })
    if (!asJson) process.stdout.write('已加密保存并启用自定义 OAuth App。\n')
    printStatus(status, asJson, dataDir)
    return
  }

  throw new Error(`未知命令 ${command}（可用：status / use-default / set / logout）`)
}

main().catch((error) => {
  process.stderr.write(`github-oauth: ${error.message}\n`)
  process.exitCode = 1
})
