import postgres from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import * as schema from './schema.js'

export function createDbClient(connectionString: string) {
  const sql = postgres(connectionString, { max: 10 })
  return drizzle(sql, { schema })
}

export type DbClient = ReturnType<typeof createDbClient>
