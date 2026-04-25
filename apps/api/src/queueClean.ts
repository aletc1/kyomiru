/**
 * Drains completed and/or failed jobs across BullMQ queues.
 *
 * Usage: queue:clean [--queue=<name>] [--state=<state>] [--waiting]
 *
 *   --queue=<name>   enrichment | showRefresh | showMerge  (default: all three)
 *   --state=<state>  completed | failed                    (default: both)
 *   --waiting        also drain waiting + delayed jobs     (destructive — opt-in)
 */
import './loadEnv.js'
import { Redis } from 'ioredis'
import type { Queue } from 'bullmq'
import { validateEnv } from './plugins/env.js'
import { createEnrichmentQueue, ENRICHMENT_QUEUE } from './workers/enrichmentWorker.js'
import { createShowRefreshQueue, SHOW_REFRESH_QUEUE } from './workers/showRefreshWorker.js'
import { createShowMergeQueue, SHOW_MERGE_QUEUE } from './workers/showMergeWorker.js'
import { logger } from './util/logger.js'

const CLEAN_BATCH = 10_000

async function cleanState(queue: Queue, state: 'completed' | 'failed'): Promise<number> {
  let total = 0
  while (true) {
    const removed = await queue.clean(0, CLEAN_BATCH, state)
    total += removed.length
    if (removed.length === 0) break
  }
  return total
}

const QUEUE_FACTORIES: Record<string, (redis: Redis) => Queue> = {
  [ENRICHMENT_QUEUE]: createEnrichmentQueue,
  [SHOW_REFRESH_QUEUE]: createShowRefreshQueue,
  [SHOW_MERGE_QUEUE]: createShowMergeQueue,
}

async function main() {
  const args = process.argv.slice(2)

  const queueArg = args.find((a) => a.startsWith('--queue='))?.split('=')[1]
  const stateArg = args.find((a) => a.startsWith('--state='))?.split('=')[1]
  const drainWaiting = args.includes('--waiting')

  if (queueArg && !(queueArg in QUEUE_FACTORIES)) {
    console.error(`Unknown queue "${queueArg}". Valid: enrichment | showRefresh | showMerge`)
    process.exit(1)
  }
  if (stateArg && !['completed', 'failed'].includes(stateArg)) {
    console.error(`Unknown state "${stateArg}". Valid: completed | failed`)
    process.exit(1)
  }

  const config = validateEnv()
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

  const queueNames = queueArg ? [queueArg] : Object.keys(QUEUE_FACTORIES)
  const queues = queueNames.map((name) => ({ name, queue: QUEUE_FACTORIES[name]!(redis) }))

  const states: Array<'completed' | 'failed'> = stateArg
    ? [stateArg as 'completed' | 'failed']
    : ['completed', 'failed']

  for (const { queue, name } of queues) {
    const removed: Record<string, number> = {}

    for (const state of states) {
      removed[state] = await cleanState(queue, state)
    }

    if (drainWaiting) {
      const before = await queue.getJobCounts('waiting', 'delayed')
      await queue.drain(true)
      removed['waiting+delayed'] = (before['waiting'] ?? 0) + (before['delayed'] ?? 0)
    }

    const parts = Object.entries(removed).map(([s, n]) => `${n} ${s}`)
    logger.info(`${name}: removed ${parts.join(', ')}`)
    await queue.close()
  }

  await redis.quit()
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
