import { describe, it, expect } from 'vitest'
import { encrypt, decrypt } from '../crypto/secretbox.js'

const TEST_KEY = Buffer.alloc(32, 0xab).toString('base64')

describe('encrypt / decrypt', () => {
  it('roundtrips plaintext correctly', async () => {
    const { ciphertext, nonce } = await encrypt('my-secret-token', TEST_KEY)
    expect(await decrypt(ciphertext, nonce, TEST_KEY)).toBe('my-secret-token')
  })

  it('roundtrips the empty string', async () => {
    const { ciphertext, nonce } = await encrypt('', TEST_KEY)
    expect(await decrypt(ciphertext, nonce, TEST_KEY)).toBe('')
  })

  it('produces unique nonces on each call', async () => {
    const a = await encrypt('same', TEST_KEY)
    const b = await encrypt('same', TEST_KEY)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('throws on a wrong key', async () => {
    const { ciphertext, nonce } = await encrypt('secret', TEST_KEY)
    const wrongKey = Buffer.alloc(32, 0x00).toString('base64')
    await expect(decrypt(ciphertext, nonce, wrongKey)).rejects.toThrow()
  })

  it('throws when ciphertext is tampered', async () => {
    const { ciphertext, nonce } = await encrypt('secret', TEST_KEY)
    const buf = Buffer.from(ciphertext, 'base64')
    buf.writeUInt8(buf.readUInt8(0) ^ 0xff, 0)
    await expect(decrypt(buf.toString('base64'), nonce, TEST_KEY)).rejects.toThrow()
  })

  it('rejects a key that is not 32 bytes', async () => {
    const shortKey = Buffer.alloc(16).toString('base64')
    await expect(encrypt('secret', shortKey)).rejects.toThrow('32 bytes')
  })
})
