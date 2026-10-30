'use strict'

/**
 * One-time OAuth `state` values.
 *
 * The value is a 256-bit random token, single-use, and short-lived. Keeping it
 * in memory only is intentional: a pending authorization cannot survive a
 * restart, which is exactly the desired behaviour for a CSRF nonce.
 */

const { randomToken } = require('./crypto')

const DEFAULT_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_PENDING = 32

class PendingStates {
  /**
   * @param {{ttlMs?: number, max?: number, now?: () => number}} [options]
   */
  constructor ({ ttlMs = DEFAULT_TTL_MS, max = DEFAULT_MAX_PENDING, now = Date.now } = {}) {
    this.ttlMs = ttlMs
    this.max = max
    this.now = now
    /** @type {Map<string, {redirectUri: string, scope: string, createdAt: number, expiresAt: number}>} */
    this.pending = new Map()
  }

  /**
   * @param {{redirectUri: string, scope: string, browserBound?: boolean}} input
   *   `browserBound` marks a state that was created by a browser request and is
   *   therefore also pinned to an HttpOnly cookie. Tool-created states cannot be
   *   cookie-pinned (no browser request exists), so they rely on the 256-bit
   *   unguessable value plus single use instead.
   * @returns {{state: string, expiresAt: number}}
   */
  create ({ redirectUri, scope, browserBound = true }) {
    this.sweep()
    while (this.pending.size >= this.max) {
      const oldest = this.pending.keys().next()
      if (oldest.done) break
      this.pending.delete(oldest.value)
    }
    const state = randomToken(32)
    const createdAt = this.now()
    const expiresAt = createdAt + this.ttlMs
    this.pending.set(state, { redirectUri, scope, browserBound: browserBound === true, createdAt, expiresAt })
    return { state, expiresAt }
  }

  /**
   * Inspect a state without consuming it; expired or unknown values return null.
   * @param {string} state
   * @returns {{redirectUri: string, scope: string, browserBound: boolean, createdAt: number, expiresAt: number} | null}
   */
  peek (state) {
    const entry = this.pending.get(state)
    if (entry === undefined) return null
    if (entry.expiresAt <= this.now()) {
      this.pending.delete(state)
      return null
    }
    return entry
  }

  /**
   * Consume a state; expired or unknown values return null.
   * @param {string} state
   * @returns {{redirectUri: string, scope: string, browserBound: boolean, createdAt: number, expiresAt: number} | null}
   */
  take (state) {
    const entry = this.pending.get(state)
    if (entry === undefined) {
      this.sweep()
      return null
    }
    this.pending.delete(state)
    if (entry.expiresAt <= this.now()) return null
    return entry
  }

  /** @returns {number} number of dropped entries. */
  sweep () {
    const now = this.now()
    let dropped = 0
    for (const [state, entry] of this.pending) {
      if (entry.expiresAt <= now) {
        this.pending.delete(state)
        dropped += 1
      }
    }
    return dropped
  }

  get size () {
    return this.pending.size
  }
}

module.exports = { PendingStates, DEFAULT_TTL_MS, DEFAULT_MAX_PENDING }
