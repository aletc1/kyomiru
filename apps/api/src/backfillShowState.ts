import './loadEnv.js'
import { ne } from 'drizzle-orm'
import { createDbClient } from '@kyomiru/db/client'
import { userShowState } from '@kyomiru/db/schema'
import { recomputeUserShowState } from './services/stateMachine.js'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

const LOG_EVERY = 500

async function backfill() {
  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)

  const rows = await db
    .select({ userId: userShowState.userId, showId: userShowState.showId })
    .from(userShowState)
    .where(ne(userShowState.status, 'removed'))

  logger.info(`Recomputing state for ${rows.length} (user, show) pairs`)

  let processed = 0
  for (const { userId, showId } of rows) {
    await recomputeUserShowState(db, userId, showId)
    processed++
    if (processed % LOG_EVERY === 0) {
      logger.info(`Recomputed ${processed}/${rows.length}`)
    }
  }

  logger.info(`Done. Recomputed ${processed} (user, show) pairs`)
}

backfill().catch((err) => {
  logger.error(err)
  process.exit(1)
})
