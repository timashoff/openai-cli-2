// Password hashing — node:crypto scrypt with a per-user random salt and
// constant-time verification. Kit defaults are the security baseline;
// override only with a reason. Memory cost is 128 * N * r = 16 MiB per
// hash at the defaults, inside node's default 32 MiB maxmem.
// Lifted verbatim from hsk-vocabulary backend/src/kit/crypto/passwords.js.

import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const DEFAULT_SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 }
const DEFAULT_KEY_LENGTH = 64
const DEFAULT_SALT_BYTES = 16

export const createPasswordHasher = ({
  scryptParams = DEFAULT_SCRYPT_PARAMS,
  keyLength = DEFAULT_KEY_LENGTH,
  saltBytes = DEFAULT_SALT_BYTES,
} = {}) => {
  const hashPassword = async (password) => {
    const salt = randomBytes(saltBytes).toString('hex')
    const hash = await scryptAsync(password, salt, keyLength, scryptParams)
    return { hash: hash.toString('hex'), salt }
  }

  const verifyPassword = async (password, storedHash, storedSalt) => {
    const computed = await scryptAsync(password, storedSalt, keyLength, scryptParams)
    const stored = Buffer.from(storedHash, 'hex')
    if (stored.length !== computed.length) return false
    return timingSafeEqual(computed, stored)
  }

  return { hashPassword, verifyPassword }
}
