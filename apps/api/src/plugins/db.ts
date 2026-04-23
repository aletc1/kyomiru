import fp from 'fastify-plugin'
import { createDbClient, type DbClient } from '@kyomiru/db/client'

declare module 'fastify' {
  interface FastifyInstance {
    db: DbClient
  }
}

export const dbPlugin = fp(async (app) => {
  const db = createDbClient(app.config.DATABASE_URL)
  app.decorate('db', db)
})
