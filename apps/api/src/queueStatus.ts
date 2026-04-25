import './loadEnv.js'
import { Redis } from 'ioredis'
import { QueueEvents } from 'bullmq'
import type { Queue } from 'bullmq'
import { validateEnv } from './plugins/env.js'
import { createEnrichmentQueue, ENRICHMENT_QUEUE } from './workers/enrichmentWorker.js'
import { createShowRefreshQueue, SHOW_REFRESH_QUEUE } from './workers/showRefreshWorker.js'
import { logger } from './util/logger.js'

function hr(label: string) {
  const width = 64
  const inner = ` ${label} `
  const pad = Math.max(0, Math.floor((width - inner.length) / 2))
  console.log(`${'─'.repeat(pad)}${inner}${'─'.repeat(width - pad - inner.length)}`)
}

function fmtAge(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`
}

async function snapshot(queue: Queue, label: string): Promise<void> {
  hr(label)
  const counts = await queue.getJobCounts('waiting', 'active', 'delayed', 'paused', 'completed', 'failed')
  console.log(
    `  waiting=${counts['waiting'] ?? 0}  active=${counts['active'] ?? 0}  delayed=${counts['delayed'] ?? 0}` +
    `  paused=${counts['paused'] ?? 0}  completed=${counts['completed'] ?? 0}  failed=${counts['failed'] ?? 0}`,
  )
  // Jobs in this repo use removeOnComplete/removeOnFail:true, so completed/failed
  // counts stay at 0 except during a brief window or if removal itself errors.

  const now = Date.now()

  const active = await queue.getActive(0, 9)
  if (active.length > 0) {
    console.log(`\n  active jobs:`)
    for (const job of active) {
      const age = job.processedOn ? fmtAge(now - job.processedOn) : '?'
      console.log(`    id=${job.id}  data=${JSON.stringify(job.data)}  age=${age}`)
    }
  }

  const waiting = await queue.getWaiting(0, 4)
  if (waiting.length > 0) {
    console.log(`\n  waiting (first ${waiting.length}):`)
    for (const job of waiting) {
      const age = fmtAge(now - job.timestamp)
      console.log(`    id=${job.id}  data=${JSON.stringify(job.data)}  queued=${age} ago`)
    }
  }

  const failed = await queue.getFailed(0, 9)
  if (failed.length > 0) {
    console.log(`\n  failed (${failed.length}):`)
    for (const job of failed) {
      const when = job.finishedOn ? new Date(job.finishedOn).toISOString() : '?'
      console.log(`    id=${job.id}  data=${JSON.stringify(job.data)}  attempts=${job.attemptsMade}  at=${when}`)
      if (job.failedReason) console.log(`    reason: ${job.failedReason}`)
    }
  }

  console.log('')
}

async function watchQueues(redis: Redis): Promise<void> {
  console.log('Watching queue events — Ctrl-C to quit\n')

  const enrichEvents = new QueueEvents(ENRICHMENT_QUEUE, { connection: redis })
  const refreshEvents = new QueueEvents(SHOW_REFRESH_QUEUE, { connection: redis })

  function attach(events: QueueEvents, label: string): void {
    events.on('waiting', ({ jobId }) => console.log(`[${label}] waiting    jobId=${jobId}`))
    events.on('active', ({ jobId }) => console.log(`[${label}] active     jobId=${jobId}`))
    events.on('completed', ({ jobId }) => console.log(`[${label}] completed  jobId=${jobId}`))
    events.on('failed', ({ jobId, failedReason }) =>
      console.log(`[${label}] failed     jobId=${jobId}  reason=${failedReason}`),
    )
    events.on('stalled', ({ jobId }) => console.log(`[${label}] STALLED    jobId=${jobId}`))
  }

  attach(enrichEvents, 'enrichment')
  attach(refreshEvents, 'showRefresh')

  await Promise.all([enrichEvents.waitUntilReady(), refreshEvents.waitUntilReady()])

  await new Promise<void>((resolve) => {
    process.once('SIGINT', resolve)
    process.once('SIGTERM', resolve)
  })

  await enrichEvents.close()
  await refreshEvents.close()
}

async function main() {
  const isWatch = process.argv.includes('--watch')
  const config = validateEnv()
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const enrichmentQueue = createEnrichmentQueue(redis)
  const showRefreshQueue = createShowRefreshQueue(redis)

  if (isWatch) {
    await watchQueues(redis)
  } else {
    await snapshot(enrichmentQueue, 'enrichment')
    await snapshot(showRefreshQueue, 'showRefresh')
  }

  await enrichmentQueue.close()
  await showRefreshQueue.close()
  await redis.quit()
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
