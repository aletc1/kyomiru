import './loadEnv.js'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { providers } from './schema.js'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is required')
  const sql = postgres(url, { max: 1 })
  const db = drizzle(sql)

  await db.insert(providers).values([
    { key: 'netflix', displayName: 'Netflix', enabled: false, kind: 'general' },
    { key: 'prime', displayName: 'Prime Video', enabled: false, kind: 'general' },
    { key: 'crunchyroll', displayName: 'Crunchyroll', enabled: true, kind: 'anime' },
  ]).onConflictDoNothing()

  console.log('Seed complete')
  await sql.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
