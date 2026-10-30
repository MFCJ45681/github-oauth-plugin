'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { encryptJson, decryptJson, deriveKey, randomKey } = require('../lib/crypto')
const { VaultStore, resolveDataDir } = require('../lib/vault')
const { DEFAULT_CLIENT_ID } = require('../lib/default-app')
const { PendingStates } = require('../lib/state')

function tempDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gho-test-'))
}

test('AES-256-GCM round-trips JSON and rejects tampering', () => {
  const key = randomKey()
  const envelope = encryptJson(key, { hello: 'world', n: 42 }, 'aad')
  assert.match(envelope, /^gho1\./)
  assert.deepEqual(decryptJson(key, envelope, 'aad'), { hello: 'world', n: 42 })
  assert.throws(() => decryptJson(key, `${envelope.slice(0, -4)}AAAA`, 'aad'))
  assert.throws(() => decryptJson(key, envelope, 'other-aad'))
  assert.throws(() => decryptJson(randomKey(), envelope, 'aad'))
})

test('deriveKey is deterministic per salt and 32 bytes wide', () => {
  const a = deriveKey('passphrase', 'salt-a')
  const b = deriveKey('passphrase', 'salt-a')
  const c = deriveKey('passphrase', 'salt-b')
  assert.equal(a.length, 32)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)
})

test('vault encrypts the secret on disk and never echoes it', () => {
  const dir = tempDir()
  const store = new VaultStore({ dataDir: dir })
  store.configure({ clientId: 'Iv1.abcdef0123456789', clientSecret: 'super-secret-value-123' })

  const raw = fs.readFileSync(path.join(dir, 'vault.json'), 'utf8')
  assert.ok(!raw.includes('super-secret-value-123'), 'client secret must not be readable on disk')
  assert.match(raw, /^gho1\./)
  assert.equal(fs.statSync(path.join(dir, 'vault.json')).mode & 0o777, 0o600)
  assert.equal(fs.statSync(path.join(dir, 'master.key')).mode & 0o777, 0o600)

  assert.equal(store.isConfigured(), true)
  assert.deepEqual(store.credentials(), { clientId: 'Iv1.abcdef0123456789', clientSecret: 'super-secret-value-123', source: 'custom' })

  const status = store.status()
  assert.equal(status.configured, true)
  assert.equal(status.connected, false)
  assert.equal(JSON.stringify(status).includes('super-secret-value-123'), false)
  assert.equal(status.clientIdMasked, 'Iv1.ab…89')
})

test('the vault defaults to the built-in OAuth App and can switch apps', () => {
  const store = new VaultStore({ dataDir: tempDir() })

  const initial = store.status()
  assert.equal(initial.authSource, 'default')
  assert.equal(initial.hasCustomApp, false)
  assert.equal(initial.configured, true)
  assert.equal(store.credentials().clientId, DEFAULT_CLIENT_ID)

  const custom = store.configure({ clientId: 'Iv1.custom', clientSecret: 'shh', mode: 'custom' })
  assert.equal(custom.authSource, 'custom')
  assert.equal(custom.hasCustomApp, true)
  assert.equal(store.credentials().clientSecret, 'shh')

  const back = store.configure({ mode: 'default' })
  assert.equal(back.authSource, 'default')
  assert.equal(back.clientIdMasked, initial.clientIdMasked)
  assert.equal(back.customClientIdMasked, 'Iv1.cu…om')
  assert.equal(store.credentials().clientId, DEFAULT_CLIENT_ID)

  const reused = store.configure({ mode: 'custom' })
  assert.equal(reused.authSource, 'custom')
  assert.deepEqual(store.credentials(), { clientId: 'Iv1.custom', clientSecret: 'shh', source: 'custom' })
})

test('vault stores tokens, keeps the account, and clears them independently', () => {
  const store = new VaultStore({ dataDir: tempDir() })
  store.configure({ clientId: 'id-123456', clientSecret: 'secret' })
  store.setToken(
    { accessToken: 'gho_token_1', scope: 'repo read:user', refreshToken: 'refresh-1', expiresAt: 0 },
    { login: 'octocat', name: 'The Octocat', avatarUrl: 'https://example.test/a.png' },
    ['repo', 'read:user']
  )
  const status = store.status()
  assert.equal(status.connected, true)
  assert.equal(status.account.login, 'octocat')
  assert.deepEqual(status.scopes, ['repo', 'read:user'])
  assert.equal(status.canRefresh, true)
  assert.equal(JSON.stringify(status).includes('gho_token_1'), false)

  store.clearToken()
  assert.equal(store.status().connected, false)
  assert.equal(store.isConfigured(), true)
})

test('vault reports a wrong master key instead of silently losing data', () => {
  const dir = tempDir()
  const store = new VaultStore({ dataDir: dir })
  store.configure({ clientId: 'id-123456', clientSecret: 'secret' })
  fs.writeFileSync(path.join(dir, 'master.key'), randomKey())
  const other = new VaultStore({ dataDir: dir })
  assert.throws(() => other.status(), (error) => error.code === 'E_VAULT_DECRYPT')
})

test('resolveDataDir honours GITHUB_OAUTH_DATA_DIR and DSH_HOME', () => {
  assert.equal(resolveDataDir({ GITHUB_OAUTH_DATA_DIR: '/tmp/gho', DSH_HOME: '/tmp/dsh' }), path.resolve('/tmp/gho'))
  assert.equal(resolveDataDir({ DSH_HOME: '/tmp/dsh' }), path.resolve('/tmp/dsh/github-oauth'))
})

test('preferences default to empty, persist across instances, and reject malformed repos', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gho-prefs-'))
  const store = new VaultStore({ dataDir: dir })
  assert.deepEqual(store.preferences(), { defaultRepo: '', pinnedRepos: [], updatedAt: null })

  const saved = store.setPreferences({ defaultRepo: 'octocat/Hello-World', pinnedRepos: ['a/b', 'a/b', 'c/d'] })
  assert.equal(saved.defaultRepo, 'octocat/Hello-World')
  assert.deepEqual(saved.pinnedRepos, ['a/b', 'c/d'], 'duplicates collapse')
  assert.ok(saved.updatedAt && typeof saved.updatedAt === 'string')

  const reopened = new VaultStore({ dataDir: dir })
  assert.equal(reopened.preferences().defaultRepo, 'octocat/Hello-World')
  assert.deepEqual(reopened.preferences().pinnedRepos, ['a/b', 'c/d'])

  assert.throws(() => store.setPreferences({ defaultRepo: 'no-slash' }), (error) => error.code === 'E_INPUT')
  assert.throws(() => store.setPreferences({ pinnedRepos: ['ok/repo', 'bad'] }), (error) => error.code === 'E_INPUT')

  const cleared = store.setPreferences({ defaultRepo: '', pinnedRepos: [] })
  assert.equal(cleared.defaultRepo, '')
  assert.deepEqual(cleared.pinnedRepos, [])
  assert.throws(() => store.setPreferences({ pinnedRepos: 'a/b' }), (error) => error.code === 'E_INPUT')
})

test('pending states are single use, expire, and cap their size', () => {
  let clock = 1000
  const states = new PendingStates({ ttlMs: 1000, max: 3, now: () => clock })
  const first = states.create({ redirectUri: 'http://x/cb', scope: 'repo', browserBound: true })
  assert.equal(states.peek(first.state).browserBound, true)
  assert.equal(states.take(first.state).redirectUri, 'http://x/cb')
  assert.equal(states.take(first.state), null, 'a consumed state cannot be replayed')

  const expiring = states.create({ redirectUri: 'http://x/cb', scope: 'repo' })
  clock += 1001
  assert.equal(states.take(expiring.state), null)

  states.create({ redirectUri: 'a', scope: 's' })
  states.create({ redirectUri: 'b', scope: 's' })
  states.create({ redirectUri: 'c', scope: 's' })
  states.create({ redirectUri: 'd', scope: 's' })
  assert.equal(states.size, 3)
  assert.ok(states.create({ redirectUri: 'e', scope: 's' }).state.length >= 40)
})
