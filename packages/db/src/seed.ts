import './loadEnv.js'
import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { sql } from 'drizzle-orm'
import { providers } from './schema.js'

async function main() {
  const url = process.env['DATABASE_URL']
  if (!url) throw new Error('DATABASE_URL is required')
  const client = postgres(url, { max: 1 })
  const db = drizzle(client)

  await db.insert(providers).values([
    {
      key: 'netflix',
      displayName: 'Netflix',
      enabled: true,
      kind: 'general',
      showUrlTemplate: 'https://www.netflix.com/title/{externalId}',
      episodeUrlTemplate: 'https://www.netflix.com/watch/{externalId}',
    },
    {
      key: 'prime',
      displayName: 'Prime Video',
      enabled: false,
      kind: 'general',
      showUrlTemplate: 'https://www.amazon.com/gp/video/detail/{externalId}',
    },
    {
      key: 'crunchyroll',
      displayName: 'Crunchyroll',
      enabled: true,
      kind: 'anime',
      showUrlTemplate: 'https://www.crunchyroll.com/series/{externalId}',
      episodeUrlTemplate: 'https://www.crunchyroll.com/watch/{externalId}',
    },
  ])
    // Upsert keeps URL templates in sync when seed values change, and intentionally
    // preserves `enabled` so a provider disabled in dev isn't re-enabled on reseed.
    .onConflictDoUpdate({
      target: providers.key,
      set: {
        displayName: sql`EXCLUDED.display_name`,
        kind: sql`EXCLUDED.kind`,
        showUrlTemplate: sql`EXCLUDED.show_url_template`,
        episodeUrlTemplate: sql`EXCLUDED.episode_url_template`,
      },
    })

  console.log('Seed complete')
  await client.end()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
