'use strict'

/**
 * Encrypted, file-backed credential vault for the GitHub OAuth plugin.
 *
 * Layout under the data directory (mode 0700):
 *   master.key  - 32 random bytes, mode 0600 (unless GITHUB_OAUTH_MASTER_KEY is set)
 *   vault.json  - one AES-256-GCM envelope holding every sensitive value, mode 0600
 *
 * Only the encrypted envelope is ever written to disk; the master key lives in a
 * separate file (or the environment) so leaking the vault file alone does not
 * expose the client secret or the tokens. Writes are atomic (tmp + rename) and
 * every read decrypts afresh, which lets an out-of-process CLI edit the vault
 * without stale caching.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const { deriveKey, encryptJson, decryptJson, randomKey, KEY_BYTES } = require('./crypto')
const { defaultCredentials } = require('./default-app')

const AAD = 'dsh/github-oauth/vault/v1'
const KEY_SALT = 'dsh/github-oauth/master-key/v1'
const KEY_FILE = 'master.key'
const VAULT_FILE = 'vault.json'
const DIR_MODE = 0o700
const FILE_MODE = 0o600

class VaultError extends Error {
  /** @param {string} message @param {string} code */
  constructor (message, code) {
    super(message)
    this.name = 'VaultError'
    this.code = code || 'E_VAULT'
  }
}

/**
 * Default data directory: GITHUB_OAUTH_DATA_DIR, else <DSH_HOME>/github-oauth.
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} absolute path.
 */
function resolveDataDir (env = process.env) {
  if (env.GITHUB_OAUTH_DATA_DIR && env.GITHUB_OAUTH_DATA_DIR.trim() !== '') {
    return path.resolve(env.GITHUB_OAUTH_DATA_DIR.trim())
  }
  const home = env.DSH_HOME && env.DSH_HOME.trim() !== ''
    ? env.DSH_HOME.trim()
    : path.join(os.homedir(), '.dsh')
  return path.join(path.resolve(home), 'github-oauth')
}

/**
 * Write a file atomically with restrictive permissions.
 * @param {string} file - destination path.
 * @param {string|Buffer} body - bytes to write.
 * @param {number} mode - POSIX mode.
 */
function writeAtomic (file, body, mode) {
  const dir = path.dirname(file)
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${Date.now().toString(36)}.tmp`)
  const fd = fs.openSync(tmp, 'w', mode)
  try {
    fs.writeFileSync(fd, body)
    try { fs.fsyncSync(fd) } catch {}
  } finally {
    fs.closeSync(fd)
  }
  try { fs.chmodSync(tmp, mode) } catch {}
  fs.renameSync(tmp, file)
  try { fs.chmodSync(file, mode) } catch {}
  try {
    const dirFd = fs.openSync(dir, 'r')
    try { fs.fsyncSync(dirFd) } catch {} finally { fs.closeSync(dirFd) }
  } catch {}
}

/** @param {string} clientId @returns {string} a readable but non-reversible label. */
function maskClientId (clientId) {
  if (typeof clientId !== 'string' || clientId === '') return ''
  if (clientId.length <= 8) return `${clientId.slice(0, 2)}…`
  return `${clientId.slice(0, 6)}…${clientId.slice(-2)}`
}

/** @param {unknown} value @returns {string} "owner/name" or '' when invalid. */
function normalizeRepo (value) {
  const text = typeof value === 'string' ? value.trim() : ''
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(text) ? text : ''
}

/** @param {unknown} value @returns {string[]} */
function normalizeScopes (value) {
  if (Array.isArray(value)) return value.filter((item) => typeof item === 'string' && item !== '')
  if (typeof value !== 'string' || value.trim() === '') return []
  return value.split(/[\s,]+/).filter(Boolean)
}

/** @param {unknown} value @returns {string|null} */
function isoOrNull (value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? new Date(value).toISOString()
    : null
}

/** @param {object} data @returns {{clientId: string, clientSecret: string}|null} */
function readStored (data) {
  const clientId = typeof data.clientId === 'string' ? data.clientId : ''
  const clientSecret = typeof data.clientSecret === 'string' ? data.clientSecret : ''
  return clientId !== '' && clientSecret !== '' ? { clientId, clientSecret } : null
}

/** @param {object} data @returns {{clientId: string, clientSecret: string, source: 'default'|'custom'}} */
function readCredentials (data) {
  const stored = readStored(data)
  const mode = data.authMode === 'custom' || data.authMode === 'default' ? data.authMode : ''
  if (mode === 'custom') {
    return stored !== null ? { ...stored, source: 'custom' } : { ...defaultCredentials(), source: 'default' }
  }
  if (mode === 'default') return { ...defaultCredentials(), source: 'default' }
  if (stored !== null) {
    const builtin = defaultCredentials()
    const same = stored.clientId === builtin.clientId && stored.clientSecret === builtin.clientSecret
    return { ...stored, source: same ? 'default' : 'custom' }
  }
  return { ...defaultCredentials(), source: 'default' }
}

/**
 * Normalize a stored token record.
 * @param {unknown} raw
 * @param {string[]|string} [scopes]
 * @returns {{accessToken: string, tokenType: string, scope: string[], refreshToken: string, expiresAt: number, refreshTokenExpiresAt: number}|null}
 */
function normalizeToken (raw, scopes) {
  if (raw === null || typeof raw !== 'object' || typeof raw.accessToken !== 'string' || raw.accessToken === '') return null
  return {
    accessToken: raw.accessToken,
    tokenType: typeof raw.tokenType === 'string' ? raw.tokenType : 'bearer',
    scope: normalizeScopes(raw.scope !== undefined ? raw.scope : scopes),
    refreshToken: typeof raw.refreshToken === 'string' ? raw.refreshToken : '',
    expiresAt: Number.isFinite(raw.expiresAt) ? raw.expiresAt : 0,
    refreshTokenExpiresAt: Number.isFinite(raw.refreshTokenExpiresAt) ? raw.refreshTokenExpiresAt : 0
  }
}

/**
 * @param {string} login
 * @param {unknown} record
 * @returns {{login: string, id: number, name: string, avatarUrl: string, scopes: string[], connectedAt: string|null, token: object}|null}
 */
function readAccountRecord (login, record) {
  if (record === null || typeof record !== 'object') return null
  const token = normalizeToken(record.token)
  if (token === null) return null
  return {
    login,
    id: Number.isFinite(record.id) ? record.id : 0,
    name: typeof record.name === 'string' ? record.name : '',
    avatarUrl: typeof record.avatarUrl === 'string' ? record.avatarUrl : '',
    scopes: normalizeScopes(record.scopes),
    connectedAt: typeof record.connectedAt === 'string' ? record.connectedAt : null,
    token
  }
}

/**
 * The pre-multi-account single token, still honoured for older vaults.
 * @param {object} data
 * @returns {object|null}
 */
function legacyAccount (data) {
  const token = normalizeToken(data.token)
  if (token === null) return null
  const account = data.account !== null && typeof data.account === 'object' ? data.account : {}
  return {
    login: typeof account.login === 'string' ? account.login : '',
    id: Number.isFinite(account.id) ? account.id : 0,
    name: typeof account.name === 'string' ? account.name : '',
    avatarUrl: typeof account.avatarUrl === 'string' ? account.avatarUrl : '',
    scopes: normalizeScopes(data.scopes),
    connectedAt: typeof data.connectedAt === 'string' ? data.connectedAt : null,
    token
  }
}

/**
 * Every connected account, newest storage layout first.
 * @param {object} data
 * @returns {object[]}
 */
function listAccounts (data) {
  const map = data.accounts !== null && typeof data.accounts === 'object' && !Array.isArray(data.accounts)
    ? data.accounts
    : null
  if (map !== null) {
    const entries = []
    for (const [login, record] of Object.entries(map)) {
      const entry = readAccountRecord(login, record)
      if (entry !== null) entries.push(entry)
    }
    if (entries.length > 0) return entries
  }
  const legacy = legacyAccount(data)
  return legacy !== null ? [legacy] : []
}

/** @param {object[]} entries @returns {Record<string, object>} */
function accountRecordsFromEntries (entries) {
  const records = {}
  for (const entry of entries) {
    records[entry.login] = {
      login: entry.login,
      id: entry.id,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      token: entry.token,
      scopes: entry.scopes,
      connectedAt: entry.connectedAt
    }
  }
  return records
}

/** @param {object} data @returns {string} */
function activeLoginOf (data) {
  const accounts = listAccounts(data)
  if (accounts.length === 0) return ''
  const wanted = typeof data.activeLogin === 'string' ? data.activeLogin : ''
  if (wanted !== '' && accounts.some((item) => item.login === wanted)) return wanted
  return accounts[0].login
}

/** Copy the active account back into the legacy single-account fields. */
function mirrorActive (data) {
  const login = activeLoginOf(data)
  const active = listAccounts(data).find((item) => item.login === login)
  if (active === undefined) {
    delete data.token
    delete data.account
    delete data.scopes
    delete data.connectedAt
    return
  }
  data.token = active.token
  data.account = { login: active.login, id: active.id, name: active.name, avatarUrl: active.avatarUrl }
  data.scopes = active.scopes
  data.connectedAt = active.connectedAt || new Date().toISOString()
}

/**
 * Public, secret-free account list for the status route and the UI.
 * @param {object} data
 * @returns {object[]}
 */
function accountsView (data) {
  const active = activeLoginOf(data)
  return listAccounts(data)
    .map((entry) => ({
      login: entry.login,
      id: entry.id,
      name: entry.name,
      avatarUrl: entry.avatarUrl,
      scopes: entry.scopes,
      connectedAt: entry.connectedAt,
      tokenExpiresAt: isoOrNull(entry.token.expiresAt),
      canRefresh: entry.token.refreshToken !== '',
      active: entry.login === active
    }))
    .sort((left, right) => (Number(right.active) - Number(left.active)) || left.login.localeCompare(right.login))
}

/** @param {object} data @returns {{defaultRepo: string, pinnedRepos: string[], updatedAt: string|null}} */
function readPreferences (data) {
  const raw = data.preferences !== null && typeof data.preferences === 'object' && !Array.isArray(data.preferences)
    ? data.preferences
    : {}
  const pinned = Array.isArray(raw.pinnedRepos) ? raw.pinnedRepos.map(normalizeRepo).filter(Boolean) : []
  return {
    defaultRepo: normalizeRepo(raw.defaultRepo),
    pinnedRepos: [...new Set(pinned)].slice(0, 50),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null
  }
}

class VaultStore {
  /**
   * @param {{ dataDir?: string, masterKey?: string|Buffer, masterKeyEnv?: string }} [options]
   */
  constructor (options = {}) {
    this.dataDir = path.resolve(options.dataDir || resolveDataDir())
    this.keyPath = path.join(this.dataDir, KEY_FILE)
    this.vaultPath = path.join(this.dataDir, VAULT_FILE)
    this.masterKeyEnv = options.masterKeyEnv || 'GITHUB_OAUTH_MASTER_KEY'
    this._explicitKey = options.masterKey === undefined ? null : options.masterKey
    this._key = null
    this._readCache = null
    this._ensured = false
  }

  /**
   * Create the data directory with restrictive permissions. Memoised: a long
   * lived plugin instance would otherwise pay two syscalls per read, which on
   * slow filesystems dominates the cost of a cached status lookup.
   */
  ensure () {
    if (this._ensured) return this
    fs.mkdirSync(this.dataDir, { recursive: true, mode: DIR_MODE })
    try { fs.chmodSync(this.dataDir, DIR_MODE) } catch {}
    this._ensured = true
    return this
  }

  /** @returns {'explicit'|'env'|'file'} where the master key comes from. */
  keySource () {
    if (this._explicitKey !== null) return 'explicit'
    const env = process.env[this.masterKeyEnv]
    if (typeof env === 'string' && env.trim() !== '') return 'env'
    return 'file'
  }

  /**
   * Resolve the AES key, generating and persisting one on first use.
   * @returns {Buffer} 32-byte key.
   */
  key () {
    if (this._key !== null) return this._key
    const explicit = this._explicitKey
    if (Buffer.isBuffer(explicit)) {
      if (explicit.length !== KEY_BYTES) throw new VaultError(`explicit master key must be ${KEY_BYTES} bytes`, 'E_MASTER_KEY')
      this._key = explicit
      return this._key
    }
    if (typeof explicit === 'string' && explicit.trim() !== '') {
      this._key = deriveKey(explicit, KEY_SALT)
      return this._key
    }
    const env = process.env[this.masterKeyEnv]
    if (typeof env === 'string' && env.trim() !== '') {
      this._key = deriveKey(env, KEY_SALT)
      return this._key
    }
    this.ensure()
    if (fs.existsSync(this.keyPath)) {
      const raw = fs.readFileSync(this.keyPath)
      if (raw.length !== KEY_BYTES) {
        throw new VaultError(`${this.keyPath} must hold exactly ${KEY_BYTES} bytes, found ${raw.length}`, 'E_MASTER_KEY')
      }
      try { fs.chmodSync(this.keyPath, FILE_MODE) } catch {}
      this._key = raw
      return this._key
    }
    const generated = randomKey()
    writeAtomic(this.keyPath, generated, FILE_MODE)
    this._key = generated
    return this._key
  }

  /** @returns {string} identity of the vault file's current bytes ('' when absent). */
  _signature () {
    try {
      const stat = fs.statSync(this.vaultPath)
      return `${stat.mtimeMs}:${stat.size}:${stat.ino}:${stat.ctimeMs}`
    } catch {
      return ''
    }
  }

  /** Forget the memoised document (after an out-of-band edit or a test write). */
  invalidate () {
    this._readCache = null
    return this
  }

  /**
   * Read and decrypt the vault document, memoised by the file's stat signature.
   * Each call returns a private copy, so callers can mutate `update()` input
   * without touching the cache. An external writer (the CLI, another process)
   * changes the signature and is picked up on the next read.
   * @returns {object} the decrypted document (empty object when no vault exists).
   */
  read () {
    this.ensure()
    const signature = this._signature()
    if (signature === '') {
      this._readCache = null
      return {}
    }
    if (this._readCache !== null && this._readCache.signature === signature) {
      return structuredClone(this._readCache.data)
    }
    const payload = fs.readFileSync(this.vaultPath, 'utf8')
    if (payload.trim() === '') {
      this._readCache = { signature, data: {} }
      return {}
    }
    let parsed
    try {
      parsed = decryptJson(this.key(), payload, AAD)
    } catch (error) {
      throw new VaultError(
        `cannot decrypt ${this.vaultPath}: ${error.message}. ` +
        'The master key does not match this vault (wrong GITHUB_OAUTH_MASTER_KEY?), ' +
        'or the file was modified. Restore the key or delete the vault to re-authenticate.',
        'E_VAULT_DECRYPT'
      )
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) parsed = {}
    this._readCache = { signature, data: parsed }
    return structuredClone(parsed)
  }

  /** @param {object} data - decrypted document to persist. */
  write (data) {
    this.ensure()
    const envelope = encryptJson(this.key(), data, AAD)
    const payload = `${envelope}\n`
    try {
      writeAtomic(this.vaultPath, payload, FILE_MODE)
    } catch (error) {
      // The directory may have been removed behind a long lived instance.
      if (error && error.code === 'ENOENT') {
        this._ensured = false
        this.ensure()
        writeAtomic(this.vaultPath, payload, FILE_MODE)
      } else {
        throw error
      }
    }
    this._readCache = { signature: this._signature(), data: structuredClone(data) }
  }

  /**
   * Synchronous read-modify-write. The updater must not await, so one process
   * cannot interleave two writers inside the same tick.
   * @param {(data: object) => object|void} mutator
   * @returns {object} the persisted document.
   */
  update (mutator) {
    const data = this.read()
    const next = mutator(data) || data
    this.write(next)
    return next
  }

  /**
   * The OAuth App pair stored in the vault, or null when none was ever saved.
   * @returns {{clientId: string, clientSecret: string}|null}
   */
  storedCredentials () {
    return readStored(this.read())
  }

  /**
   * Resolve which OAuth App to use: the saved custom pair when the vault says
   * so, otherwise the built-in app (overridable through the environment).
   * Vaults written before mode tracking existed keep their saved pair.
   * @returns {{clientId: string, clientSecret: string, source: 'default'|'custom'}}
   */
  credentials () {
    return readCredentials(this.read())
  }

  /** @returns {boolean} */
  isConfigured () {
    const { clientId, clientSecret } = this.credentials()
    return clientId !== '' && clientSecret !== ''
  }

  /**
   * Select the built-in OAuth App, or save a custom pair and select it. A
   * switch to a custom app without a pair reuses the previously saved pair.
   * The secret is encrypted like every other value.
   * @param {{ clientId?: string, clientSecret?: string, mode?: 'default'|'custom' }} [options]
   * @returns {object} the new status.
   */
  configure ({ clientId, clientSecret, mode } = {}) {
    const next = mode === 'default' ? 'default' : 'custom'
    if (next === 'custom') {
      const id = typeof clientId === 'string' ? clientId.trim() : ''
      const secret = typeof clientSecret === 'string' ? clientSecret.trim() : ''
      const stored = this.storedCredentials()
      if ((id === '') !== (secret === '')) {
        throw new VaultError('clientId and clientSecret must be provided together', 'E_INPUT')
      }
      if (id === '' && stored === null) {
        throw new VaultError('clientId and clientSecret are required for a custom OAuth App', 'E_INPUT')
      }
      this.update((current) => {
        current.version = 1
        current.authMode = 'custom'
        if (id !== '') {
          current.clientId = id
          current.clientSecret = secret
        }
        current.updatedAt = new Date().toISOString()
        return current
      })
    } else {
      this.update((current) => {
        current.version = 1
        current.authMode = 'default'
        current.updatedAt = new Date().toISOString()
        return current
      })
    }
    return this.status()
  }

  /** Forget the saved custom pair (the built-in app stays available). */
  clearCredentials () {
    this.update((current) => {
      delete current.authMode
      delete current.clientId
      delete current.clientSecret
      delete current.accounts
      delete current.activeLogin
      delete current.token
      delete current.account
      delete current.connectedAt
      delete current.scopes
      return current
    })
  }

  /**
   * Persist one token for the account it belongs to. Adds the account when it is
   * new and, unless `activate` is false, makes it the active account.
   * @param {{accessToken: string, tokenType?: string, scope?: string|string[], refreshToken?: string, expiresAt?: number, refreshTokenExpiresAt?: number}} token
   * @param {{login: string, id?: number, name?: string, avatarUrl?: string}} account
   * @param {string[]} [scopes]
   * @param {{activate?: boolean}} [options]
   */
  setToken (token, account, scopes, options = {}) {
    const login = typeof account.login === 'string' ? account.login.trim() : ''
    if (login === '') throw new VaultError('cannot store a token for an account without a login', 'E_INPUT')
    const activate = options.activate !== false
    this.update((current) => {
      const records = accountRecordsFromEntries(listAccounts(current))
      records[login] = {
        login,
        id: Number.isFinite(account.id) ? account.id : 0,
        name: account.name || '',
        avatarUrl: account.avatarUrl || '',
        token: normalizeToken(token, scopes),
        scopes: normalizeScopes(scopes !== undefined ? scopes : token.scope),
        connectedAt: new Date().toISOString()
      }
      current.version = 2
      current.accounts = records
      current.activeLogin = activate ? login : (activeLoginOf(current) || login)
      mirrorActive(current)
      return current
    })
  }

  /**
   * Read one account's token; the active account when `login` is omitted.
   * @param {string} [login]
   * @returns {{accessToken: string, tokenType: string, scope: string[], refreshToken: string, expiresAt: number, refreshTokenExpiresAt: number}|null}
   */
  token (login) {
    const data = this.read()
    const wanted = typeof login === 'string' && login !== '' ? login : activeLoginOf(data)
    const entry = listAccounts(data).find((item) => item.login === wanted)
    return entry !== undefined ? entry.token : null
  }

  /** @returns {object[]} public, secret-free account list. */
  accounts () {
    return accountsView(this.read())
  }

  /** @returns {string} login of the active account, or ''. */
  activeLogin () {
    return activeLoginOf(this.read())
  }

  /** @returns {{login: string, id: number, name: string, avatarUrl: string}|null} */
  activeAccount () {
    const data = this.read()
    const login = activeLoginOf(data)
    const entry = listAccounts(data).find((item) => item.login === login)
    return entry !== undefined
      ? { login: entry.login, id: entry.id, name: entry.name, avatarUrl: entry.avatarUrl }
      : null
  }

  /**
   * Make a stored account the active one.
   * @param {string} login
   * @returns {object} the new status.
   */
  switchAccount (login) {
    const wanted = typeof login === 'string' ? login.trim() : ''
    const data = this.read()
    if (!listAccounts(data).some((item) => item.login === wanted)) {
      throw new VaultError(`no stored GitHub account named "${wanted}"`, 'E_NOT_FOUND')
    }
    this.update((current) => {
      current.version = 2
      current.accounts = accountRecordsFromEntries(listAccounts(current))
      current.activeLogin = wanted
      mirrorActive(current)
      return current
    })
    return this.status()
  }

  /**
   * Forget one account. Removing the active account promotes the next one.
   * @param {string} login
   * @returns {object} the new status.
   */
  removeAccount (login) {
    const wanted = typeof login === 'string' ? login.trim() : ''
    this.update((current) => {
      const previousActive = activeLoginOf(current)
      const entries = listAccounts(current).filter((item) => item.login !== wanted)
      current.version = 2
      if (entries.length === 0) {
        delete current.accounts
        delete current.activeLogin
        delete current.token
        delete current.account
        delete current.scopes
        delete current.connectedAt
      } else {
        current.accounts = accountRecordsFromEntries(entries)
        current.activeLogin = previousActive !== wanted && entries.some((item) => item.login === previousActive)
          ? previousActive
          : entries[0].login
      }
      mirrorActive(current)
      return current
    })
    return this.status()
  }

  /** Forget every account while keeping the OAuth App pair. */
  clearToken () {
    this.update((current) => {
      delete current.accounts
      delete current.activeLogin
      delete current.token
      delete current.account
      delete current.connectedAt
      delete current.scopes
      return current
    })
  }

  /**
   * Non-secret preferences: the default repository used when a tool call omits
   * `repo`, plus the pinned repository list shown in the settings page.
   * @returns {{defaultRepo: string, pinnedRepos: string[], updatedAt: string|null}}
   */
  preferences () {
    return readPreferences(this.read())
  }

  /**
   * Replace the preferences; omitted keys keep their current value.
   * @param {{defaultRepo?: unknown, pinnedRepos?: unknown}} patch
   * @returns {{defaultRepo: string, pinnedRepos: string[], updatedAt: string|null}}
   */
  setPreferences (patch = {}) {
    const current = this.preferences()
    let defaultRepo = current.defaultRepo
    if (patch.defaultRepo !== undefined) {
      const text = typeof patch.defaultRepo === 'string' ? patch.defaultRepo.trim() : ''
      defaultRepo = text === '' ? '' : normalizeRepo(text)
      if (text !== '' && defaultRepo === '') {
        throw new VaultError(`default repo must look like "owner/name", got "${text}"`, 'E_INPUT')
      }
    }
    let pinnedRepos = current.pinnedRepos
    if (patch.pinnedRepos !== undefined) {
      if (!Array.isArray(patch.pinnedRepos)) {
        throw new VaultError('pinnedRepos must be an array of "owner/name" strings', 'E_INPUT')
      }
      const next = patch.pinnedRepos.map(normalizeRepo)
      if (next.some((item) => item === '')) {
        throw new VaultError('every pinned repository must look like "owner/name"', 'E_INPUT')
      }
      pinnedRepos = [...new Set(next)].slice(0, 50)
    }
    this.update((data) => {
      data.version = 1
      data.preferences = { defaultRepo, pinnedRepos, updatedAt: new Date().toISOString() }
      return data
    })
    return this.preferences()
  }

  /**
   * Public, secret-free view of the vault used by the status route, the panel
   * and github_auth_status. Never includes the secret or the tokens.
   * @returns {object}
   */
  status () {
    const data = this.read()
    const accounts = accountsView(data)
    const activeLogin = activeLoginOf(data)
    const active = accounts.find((entry) => entry.active) || null
    const app = readCredentials(data)
    const stored = readStored(data)
    return {
      configured: app.clientId !== '' && app.clientSecret !== '',
      authSource: app.source,
      hasCustomApp: stored !== null && !(app.source === 'default' && stored.clientId === app.clientId && stored.clientSecret === app.clientSecret),
      connected: active !== null,
      clientIdMasked: maskClientId(app.clientId),
      customClientIdMasked: stored !== null ? maskClientId(stored.clientId) : '',
      account: active !== null
        ? { login: active.login, name: active.name, avatarUrl: active.avatarUrl }
        : null,
      scopes: active !== null ? active.scopes : [],
      connectedAt: active !== null ? active.connectedAt : null,
      tokenExpiresAt: active !== null ? active.tokenExpiresAt : null,
      canRefresh: active !== null && active.canRefresh,
      accounts,
      activeLogin,
      vault: {
        path: this.vaultPath,
        encrypted: true,
        algorithm: 'aes-256-gcm',
        keySource: this.keySource()
      }
    }
  }
}

module.exports = { VaultStore, VaultError, resolveDataDir, maskClientId, normalizeRepo, normalizeScopes }
