import './loadEnv.js'
import { Redis } from 'ioredis'
import { createDbClient } from '@kyomiru/db/client'
import { validateEnv } from './plugins/env.js'
import { createShowRefreshQueue, enqueueShowRefresh } from './workers/showRefreshWorker.js'
import { findPhantoms, deletePhantoms } from './services/phantomEpisodes.service.js'
import type { PhantomRow } from './services/phantomEpisodes.service.js'
import { logger } from './util/logger.js'

/**
 * Detect and delete phantom duplicate episodes left over from an old catalog
 * shape that disagreed with TMDb/AniList. A phantom is an episode that:
 *   - has another episode in a higher-numbered season of the same show with
 *     the same normalized title (case/whitespace/smart-quote insensitive),
 *   - has no row in episode_providers,
 *   - has no row in user_episode_progress (stricter than "watched=false" —
 *     never delete a row a user has scrubbed into),
 *   - while the higher-season counterpart DOES have a provider mapping (i.e.
 *     it's the canonical row backed by an actual streaming entry).
 *
 * Modes:
 *   cleanup:phantom-eps --scan            list candidates (dry run)
 *   cleanup:phantom-eps --scan --apply    delete every flagged phantom
 *   cleanup:phantom-eps <showId> [--apply]  scope to one show
 */

async function main() {
  const args = process.argv.slice(2)
  const scan = args.includes('--scan')
  const apply = args.includes('--apply')
  const showId = args.find((a) => !a.startsWith('--'))

  if (!scan && !showId) {
    console.error('Usage:')
    console.error('  cleanup:phantom-eps --scan            list phantom episodes (dry run)')
    console.error('  cleanup:phantom-eps --scan --apply    delete every flagged phantom')
    console.error('  cleanup:phantom-eps <showId> [--apply]  scope to one show')
    process.exit(1)
  }

  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

  try {
    const phantoms = await findPhantoms(db, showId ?? null)

    if (phantoms.length === 0) {
      logger.info({ scope: showId ?? 'all' }, 'no phantom episodes found')
      return
    }

    const byShow = new Map<string, PhantomRow[]>()
    for (const p of phantoms) {
      const arr = byShow.get(p.show_id) ?? []
      arr.push(p)
      byShow.set(p.show_id, arr)
    }

    logger.info({ totalPhantoms: phantoms.length, shows: byShow.size }, 'phantom episodes detected')
    for (const [, group] of byShow) {
      const sample = group[0]!
      logger.info(
        {
          showId: sample.show_id,
          title: sample.show_title,
          phantomCount: group.length,
          example: `S${sample.phantom_season}E${sample.phantom_ep} "${sample.title}" matches S${sample.canonical_season}E${sample.canonical_ep}`,
        },
        'show phantoms',
      )
    }

    if (!apply) {
      logger.info('dry run — pass --apply to delete')
      return
    }

    const { deleted, seasonsTouched, affectedShowIds } = await deletePhantoms(db, phantoms)

    const showRefreshQueue = createShowRefreshQueue(redis)
    try {
      for (const sId of affectedShowIds) await enqueueShowRefresh(showRefreshQueue, sId)
    } finally {
      await showRefreshQueue.close()
    }

    logger.info({ deleted, seasonsTouched, showsRefreshed: affectedShowIds.length }, 'phantom cleanup complete')
  } finally {
    await redis.quit()
  }
}

void main().then(() => process.exit(0)).catch((err) => {
  logger.error({ err }, 'cleanup failed')
  process.exit(1)
})
