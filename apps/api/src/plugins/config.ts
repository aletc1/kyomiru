import fp from 'fastify-plugin'
import { validateEnv, type Env } from './env.js'

declare module 'fastify' {
  interface FastifyInstance {
    config: Env
  }
}

export const configPlugin = fp(async (app) => {
  app.decorate('config', validateEnv())
})
