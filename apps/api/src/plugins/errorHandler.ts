import fp from 'fastify-plugin'
import { ZodError } from 'zod'

export const errorHandlerPlugin = fp(async (app) => {
  app.setErrorHandler((rawErr, _req, reply) => {
    const err = rawErr as Error & { statusCode?: number }
    if (err instanceof ZodError) {
      return reply.status(400).send({ error: 'Validation error', details: err.flatten() })
    }
    app.log.error(err)
    const status = err.statusCode ?? 500
    reply.status(status).send({ error: err.message ?? 'Internal server error' })
  })
})
