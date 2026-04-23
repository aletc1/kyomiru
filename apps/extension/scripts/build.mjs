import { cp, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const STATIC_FILES = ['manifest.json', 'popup.html']

if (!existsSync('dist')) await mkdir('dist', { recursive: true })

for (const file of STATIC_FILES) {
  await cp(file, `dist/${file}`)
  console.log(`  copy ${file} -> dist/${file}`)
}

console.log('Extension build complete. Load apps/extension/dist as unpacked.')
