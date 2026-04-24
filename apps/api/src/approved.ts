import './loadEnv.js'
import { createDbClient } from '@kyomiru/db/client'
import { approvedEmails } from '@kyomiru/db/schema'
import { eq } from 'drizzle-orm'
import { Redis } from 'ioredis'
import { validateEnv } from './plugins/env.js'
import { logger } from './util/logger.js'

async function main() {
  const [, , subcommand, emailArg, ...rest] = process.argv

  if (!subcommand || !['add', 'remove', 'list'].includes(subcommand)) {
    console.error('Usage: approved <add|remove|list> [email] [note]')
    process.exit(1)
  }

  const config = validateEnv()
  const db = createDbClient(config.DATABASE_URL)

  if (subcommand === 'list') {
    const rows = await db
      .select()
      .from(approvedEmails)
      .orderBy(approvedEmails.email)
    if (rows.length === 0) {
      console.log('No approved emails.')
    } else {
      console.log(`${rows.length} approved email(s):`)
      for (const row of rows) {
        const note = row.note ? `  # ${row.note}` : ''
        console.log(`  ${row.email}${note}`)
      }
    }
    return
  }

  if (!emailArg) {
    console.error(`Usage: approved ${subcommand} <email> [note]`)
    process.exit(1)
  }

  const email = emailArg.trim().toLowerCase()
  const redis = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })
  const invalidateCache = (e: string) => redis.del(`auth:approved:${e.toLowerCase()}`)

  try {
    if (subcommand === 'add') {
      const note = rest.length > 0 ? rest.join(' ') : null
      if (note === null) {
        // Re-add without a note should NOT clobber an existing note.
        await db.insert(approvedEmails).values({ email }).onConflictDoNothing()
      } else {
        await db
          .insert(approvedEmails)
          .values({ email, note })
          .onConflictDoUpdate({ target: approvedEmails.email, set: { note } })
      }
      await invalidateCache(email)
      logger.info({ email }, 'Approved email added')
      console.log(`Added: ${email}`)
    } else if (subcommand === 'remove') {
      const result = await db
        .delete(approvedEmails)
        .where(eq(approvedEmails.email, email))
        .returning({ email: approvedEmails.email })
      await invalidateCache(email)
      if (result.length === 0) {
        console.log(`Not found: ${email}`)
      } else {
        logger.info({ email }, 'Approved email removed')
        console.log(`Removed: ${email}`)
      }
    }
  } finally {
    await redis.quit()
  }
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
