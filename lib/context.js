'use strict'

/**
 * Repository context for the github_* tools.
 *
 * Every repo-scoped tool can append a compact, cached snapshot of the target
 * repository — description, languages, topics, top-level tree and a README
 * excerpt — so the model does not need a second round trip just to orient
 * itself. Three REST calls (repo, readme, contents) run in parallel; results
 * are memoised per repository so the rest of a turn is free.
 */

const REPO_CONTEXT_TTL_MS = 60 * 1000
const DEFAULT_README_CHARS = 1200
const MAX_TREE_ENTRIES = 30

class RepoContextError extends Error {
  /** @param {string} message @param {string} [code] */
  constructor (message, code) {
    super(message)
    this.name = 'RepoContextError'
    this.code = code || 'E_CONTEXT'
  }
}

/** @returns {Map<string, {at: number, value: object}>} a per-plugin context memo. */
function createRepoContextCache () {
  return new Map()
}

/**
 * @param {string} fullName owner/name
 * @param {object} repoJson /repos/{owner}/{repo} payload
 * @param {object|null} readmeJson /repos/{owner}/{repo}/readme payload
 * @param {object|null} contentsJson /repos/{owner}/{repo}/contents payload
 * @param {{readmeChars?: number, maxEntries?: number, truncated?: boolean}} options
 */
function buildContext (fullName, repoJson, readmeJson, contentsJson, options) {
  const repo = repoJson !== null && typeof repoJson === 'object' ? repoJson : {}
  const readmeChars = Math.max(200, Math.min(8000, Number(options.readmeChars) || DEFAULT_README_CHARS))
  const maxEntries = Math.max(3, Math.min(100, Number(options.maxEntries) || MAX_TREE_ENTRIES))
  const defaultBranch = typeof repo.default_branch === 'string' && repo.default_branch !== '' ? repo.default_branch : ''
  const description = typeof repo.description === 'string' ? repo.description : ''
  const language = typeof repo.language === 'string' ? repo.language : ''
  const stars = Number(repo.stargazers_count) || 0
  const topics = Array.isArray(repo.topics) ? repo.topics.slice(0, 10) : []

  const entries = Array.isArray(contentsJson)
    ? contentsJson
        .map((entry) => ({
          name: typeof entry.name === 'string' ? entry.name : '',
          type: typeof entry.type === 'string' ? entry.type : '',
          size: Number(entry.size) || 0
        }))
        .filter((entry) => entry.name !== '')
        .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1))
    : []
  const shownEntries = entries.slice(0, maxEntries)

  let readme = ''
  let readmeTruncated = false
  if (readmeJson !== null && typeof readmeJson === 'object') {
    const encoding = typeof readmeJson.encoding === 'string' ? readmeJson.encoding : ''
    const raw = typeof readmeJson.content === 'string' ? readmeJson.content.replace(/\s+/g, '') : ''
    if (encoding === 'base64' && raw !== '') {
      try {
        const text = Buffer.from(raw, 'base64').toString('utf8')
        readmeTruncated = text.length > readmeChars
        readme = readmeTruncated ? `${text.slice(0, readmeChars)}\n… (README 已截断)` : text
      } catch {
        readme = ''
      }
    }
  }

  const treeLine = shownEntries.length === 0
    ? '顶层：无法读取（权限或空仓库）'
    : `顶层（${entries.length} 项${entries.length > shownEntries.length ? `，显示前 ${shownEntries.length}` : ''}）：` +
      shownEntries.map((entry) => (entry.type === 'dir' ? `${entry.name}/` : entry.name)).join(' · ')

  const text = [
    `仓库上下文 ${fullName}${defaultBranch !== '' ? `（默认分支 ${defaultBranch}）` : ''}`,
    description !== '' ? description : '(没有仓库描述)',
    `${language !== '' ? language : 'n/a'} · ★ ${stars}` + (topics.length > 0 ? ` · topics: ${topics.join(', ')}` : ''),
    treeLine,
    readme !== ''
      ? `README 摘要：\n${readme}`
      : 'README：无'
  ].join('\n')

  return {
    text,
    data: {
      fullName,
      defaultBranch,
      language,
      stars,
      topics,
      entries,
      readmeChars: readme.length,
      readmeTruncated,
      fetchedAt: new Date().toISOString()
    }
  }
}

/**
 * Load (or reuse) the context snapshot for one repository.
 * @param {import('./github-api').GitHubApi} api
 * @param {string} fullName
 * @param {{cache?: Map<string, {at: number, value: object}>|null, ttlMs?: number, readmeChars?: number, maxEntries?: number}} [options]
 * @returns {Promise<{text: string, data: object}>}
 */
async function loadRepoContext (api, fullName, options = {}) {
  if (typeof fullName !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(fullName)) {
    throw new RepoContextError('repository must look like "owner/name"', 'E_INPUT')
  }
  const cache = options.cache || null
  const ttlMs = Math.max(1000, Number(options.ttlMs) || REPO_CONTEXT_TTL_MS)
  const key = fullName.toLowerCase()
  if (cache !== null) {
    const hit = cache.get(key)
    if (hit !== undefined && Date.now() - hit.at < ttlMs) return hit.value
  }
  const [repo, readme, contents] = await Promise.all([
    api.request('GET', `/repos/${fullName}`, { cacheTtlMs: ttlMs }),
    api.request('GET', `/repos/${fullName}/readme`, { cacheTtlMs: ttlMs }).catch(() => null),
    api.request('GET', `/repos/${fullName}/contents/`, { cacheTtlMs: ttlMs }).catch(() => null)
  ])
  if (!repo.ok) {
    throw new RepoContextError(
      `cannot load context for ${fullName}: GitHub returned HTTP ${repo.status}`,
      repo.status === 404 ? 'E_NOT_FOUND' : 'E_CONTEXT'
    )
  }
  const value = buildContext(fullName, repo.json, readme !== null && readme.ok ? readme.json : null, contents !== null && contents.ok ? contents.json : null, options)
  if (cache !== null) cache.set(key, { at: Date.now(), value })
  return value
}

module.exports = {
  createRepoContextCache,
  loadRepoContext,
  buildContext,
  RepoContextError,
  REPO_CONTEXT_TTL_MS,
  DEFAULT_README_CHARS
}
