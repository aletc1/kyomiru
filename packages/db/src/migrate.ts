import './loadEnv.js'
import postgres from 'postgres'
import { readdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is required')

  const sql = postgres(url, { max: 1 })

  // Tracking table — created outside a transaction so it survives on first run
  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      id   serial      PRIMARY KEY,
      name text UNIQUE NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `

  const migrationsDir = join(__dirname, 'migrations')
  const files = (await readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort()

  for (const file of files) {
    const [existing] = await sql`SELECT id FROM _migrations WHERE name = ${file}`
    if (existing) {
      console.log(`  skip  ${file}`)
      continue
    }

    const content = await readFile(join(migrationsDir, file), 'utf-8')
    console.log(`  apply ${file}`)
    await sql.unsafe(content)
    await sql`INSERT INTO _migrations (name) VALUES (${file})`
  }

  console.log('Migrations complete.')
  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
