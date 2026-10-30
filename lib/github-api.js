'use strict'

/**
 * Thin GitHub REST client. It adds the headers GitHub requires (API version,
 * user agent, bearer token), parses JSON when the response is JSON, and reports
 * status plus rate-limit metadata without deciding whether a non-2xx response
 * is an error — the tools translate that into structured results.
 */

const { API_BASE, USER_AGENT } = require('./oauth')

class GitHubApiError extends Error {
  /**
   * @param {string} message
   * @param {{code?: string, status?: number}} [options]
   */
  constructor (message, options = {}) {
    super(message)
    this.name = 'GitHubApiError'
    this.code = options.code || 'E_API'
    this.status = Number.isInteger(options.status) ? options.status : 0
  }
}

/** Default cap on the response text kept in memory, in bytes. */
const DEFAULT_MAX_BYTES = 256 * 1024

/**
 * @param {Record<string, unknown>} query
 * @param {URL} url
 */
function applyQuery (query, url) {
  if (query === null || typeof query !== 'object') return
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue
    if (Array.isArray(value)) {
      if (value.length > 0) url.searchParams.set(key, value.join(','))
      continue
    }
    url.searchParams.set(key, String(value))
  }
}

class GitHubApi {
  /**
   * @param {{accessToken: string, baseUrl?: string, fetchImpl?: typeof fetch, userAgent?: string}} options
   */
  constructor ({ accessToken, baseUrl = API_BASE, fetchImpl = fetch, userAgent = USER_AGENT }) {
    if (typeof accessToken !== 'string' || accessToken === '') {
      throw new GitHubApiError('an access token is required', { code: 'E_NOT_CONNECTED' })
    }
    this.accessToken = accessToken
    this.baseUrl = baseUrl.replace(/\/+$/, '')
    this.fetchImpl = fetchImpl
    this.userAgent = userAgent
  }

  /**
   * Dispatch one REST call.
   * @param {string} method - GET, POST, PATCH, PUT, DELETE or HEAD.
   * @param {string} apiPath - absolute API path such as `/repos/o/r/issues`.
   * @param {{query?: Record<string, unknown>, body?: unknown, accept?: string, maxBytes?: number}} [options]
   * @returns {Promise<{ok: boolean, status: number, url: string, json: unknown, text: string, truncated: boolean, contentType: string, rateLimit: {remaining: number|null, reset: number|null, limit: number|null}, link: string}>}
   */
  async request (method, apiPath, options = {}) {
    const verb = (method || 'GET').toUpperCase()
    if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'HEAD'].includes(verb)) {
      throw new GitHubApiError(`unsupported method ${verb}`, { code: 'E_METHOD' })
    }
    if (typeof apiPath !== 'string' || !apiPath.startsWith('/') || apiPath.startsWith('//')) {
      throw new GitHubApiError('path must be an absolute API path such as /user/repos', { code: 'E_PATH' })
    }
    const url = new URL(`${this.baseUrl}${apiPath}`)
    applyQuery(options.query, url)
    const headers = {
      accept: options.accept || 'application/vnd.github+json',
      authorization: `Bearer ${this.accessToken}`,
      'user-agent': this.userAgent,
      'x-github-api-version': '2022-11-28'
    }
    let payload
    if (options.body !== undefined) {
      headers['content-type'] = 'application/json'
      payload = JSON.stringify(options.body)
    }
    let response
    try {
      response = await this.fetchImpl(url.toString(), {
        method: verb,
        headers,
        body: payload,
        signal: AbortSignal.timeout(30000)
      })
    } catch (error) {
      throw new GitHubApiError(`cannot reach ${this.baseUrl}: ${error.message}`, { code: 'E_NETWORK' })
    }
    const contentType = response.headers.get('content-type') || ''
    const limit = options.maxBytes === undefined ? DEFAULT_MAX_BYTES : Math.max(1024, options.maxBytes)
    let raw = await response.text()
    let truncated = false
    if (Buffer.byteLength(raw, 'utf8') > limit) {
      raw = Buffer.from(raw, 'utf8').subarray(0, limit).toString('utf8')
      truncated = true
    }
    let json = null
    if (raw !== '' && (contentType.includes('json') || /^\s*[[{]/.test(raw)) && !truncated) {
      try { json = JSON.parse(raw) } catch {}
    }
    return {
      ok: response.ok,
      status: response.status,
      url: url.toString(),
      json,
      text: raw,
      truncated,
      contentType,
      rateLimit: {
        remaining: numberOrNull(response.headers.get('x-ratelimit-remaining')),
        reset: numberOrNull(response.headers.get('x-ratelimit-reset')),
        limit: numberOrNull(response.headers.get('x-ratelimit-limit'))
      },
      link: response.headers.get('link') || ''
    }
  }

  /** @param {string} apiPath @param {Record<string, unknown>} [query] */
  get (apiPath, query) {
    return this.request('GET', apiPath, { query })
  }

  /** @param {string} apiPath @param {unknown} body */
  post (apiPath, body) {
    return this.request('POST', apiPath, { body })
  }
}

/** @param {string|null} value @returns {number|null} */
function numberOrNull (value) {
  if (value === null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

module.exports = { GitHubApi, GitHubApiError, DEFAULT_MAX_BYTES }
