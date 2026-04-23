import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const ALGO = 'aes-256-gcm'
const NONCE_BYTES = 12
const TAG_BYTES = 16

function loadKey(masterKeyBase64: string): Buffer {
  const key = Buffer.from(masterKeyBase64, 'base64')
  if (key.length !== 32) throw new Error('APP_SECRET_KEY must decode to 32 bytes')
  return key
}

export async function encrypt(plaintext: string, masterKeyBase64: string): Promise<{ ciphertext: string; nonce: string }> {
  const key = loadKey(masterKeyBase64)
  const nonce = randomBytes(NONCE_BYTES)
  const cipher = createCipheriv(ALGO, key, nonce)
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    ciphertext: Buffer.concat([enc, tag]).toString('base64'),
    nonce: nonce.toString('base64'),
  }
}

export async function decrypt(ciphertext: string, nonce: string, masterKeyBase64: string): Promise<string> {
  const key = loadKey(masterKeyBase64)
  const nonceBuf = Buffer.from(nonce, 'base64')
  const combined = Buffer.from(ciphertext, 'base64')
  const enc = combined.subarray(0, combined.length - TAG_BYTES)
  const tag = combined.subarray(combined.length - TAG_BYTES)
  const decipher = createDecipheriv(ALGO, key, nonceBuf)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
