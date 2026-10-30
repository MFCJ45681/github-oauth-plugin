'use strict'

/**
 * AES-256-GCM envelope for the GitHub OAuth vault.
 *
 * The vault is a single JSON document encrypted as one AEAD message, so the
 * client secret, the access token and the refresh token share one ciphertext:
 * no field of it is readable without the master key, and any modification of
 * the file makes decryption fail loudly instead of yielding partial data.
 *
 * The payload format is ``gho1.<iv>.<tag>.<ciphertext>`` with every binary part
 * base64-encoded. The format prefix is authenticated through the AAD, so a
 * payload from another vault or another format version cannot be substituted.
 */

const crypto = require('node:crypto')

const ALGORITHM = 'aes-256-gcm'
const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const FORMAT = 'gho1'

/** @param {unknown} key - candidate AES key. */
function assertKey (key) {
  if (!Buffer.isBuffer(key) || key.length !== KEY_BYTES) {
    throw new TypeError(`master key must be a ${KEY_BYTES}-byte Buffer`)
  }
}

/**
 * Derive a stable AES key from a passphrase-shaped environment value.
 * @param {string} material - non-empty secret material.
 * @param {string} salt - format-stable salt for this purpose.
 * @returns {Buffer} the 32-byte key.
 */
function deriveKey (material, salt) {
  if (typeof material !== 'string' || material.trim() === '') {
    throw new TypeError('master key material must be a non-empty string')
  }
  return crypto.scryptSync(material.trim(), Buffer.from(salt, 'utf8'), KEY_BYTES)
}

/** @returns {Buffer} a fresh random 32-byte key. */
function randomKey () {
  return crypto.randomBytes(KEY_BYTES)
}

/** @returns {string} a URL-safe, 32-byte random token. */
function randomToken () {
  return crypto.randomBytes(32).toString('base64url')
}

/**
 * Encrypt one JSON value.
 * @param {Buffer} key - 32-byte AES key.
 * @param {unknown} value - JSON-serializable value.
 * @param {string} [aad] - associated data bound into the envelope.
 * @returns {string} the ASCII envelope.
 */
function encryptJson (key, value, aad = '') {
  assertKey(key)
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
  if (aad !== '') cipher.setAAD(Buffer.from(aad, 'utf8'))
  const plaintext = Buffer.from(JSON.stringify(value), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return [FORMAT, iv.toString('base64'), tag.toString('base64'), ciphertext.toString('base64')].join('.')
}

/**
 * Decrypt one envelope produced by {@link encryptJson}.
 * @param {Buffer} key - the same 32-byte AES key.
 * @param {string} payload - ASCII envelope.
 * @param {string} [aad] - the same associated data.
 * @returns {unknown} the parsed JSON value.
 */
function decryptJson (key, payload, aad = '') {
  assertKey(key)
  if (typeof payload !== 'string' || payload === '') {
    throw new Error('vault payload is empty')
  }
  const parts = payload.split('.')
  if (parts.length !== 4 || parts[0] !== FORMAT) {
    throw new Error('vault payload is not a gho1 envelope')
  }
  const iv = Buffer.from(parts[1], 'base64')
  const tag = Buffer.from(parts[2], 'base64')
  const ciphertext = Buffer.from(parts[3], 'base64')
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new Error('vault payload has malformed IV or authentication tag')
  }
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES })
    if (aad !== '') decipher.setAAD(Buffer.from(aad, 'utf8'))
    decipher.setAuthTag(tag)
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
    return JSON.parse(plaintext.toString('utf8'))
  } catch (error) {
    throw new Error(`vault decryption failed: ${error.message}`)
  }
}

module.exports = { deriveKey, encryptJson, decryptJson, randomKey, randomToken, KEY_BYTES }
