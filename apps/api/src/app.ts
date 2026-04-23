import fastify from 'fastify'
import secureSession from '@fastify/secure-session'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { configPlugin } from './plugins/config.js'
import { dbPlugin } from './plugins/db.js'
import { redisPlugin } from './plugins/redis.js'
import { authPlugin } from './plugins/auth.js'
import { enrichmentQueuePlugin } from './plugins/enrichmentQueue.js'
import { errorHandlerPlugin } from './plugins/errorHandler.js'
import { authRoutes } from './routes/auth.routes.js'
import { meRoutes } from './routes/me.routes.js'
import { servicesRoutes } from './routes/services.routes.js'
import { libraryRoutes } from './routes/library.routes.js'
import { showsRoutes } from './routes/shows.routes.js'
import { queueRoutes } from './routes/queue.routes.js'
import { newContentRoutes } from './routes/newContent.routes.js'
import { healthzRoutes } from './routes/healthz.routes.js'
import { extensionRoutes } from './routes/extension.routes.js'
import { providersRoutes } from './routes/providers.routes.js'
import { logger } from './util/logger.js'

export async function buildApp() {
  const app = fastify({ loggerInstance: logger })

  // Config must be first
  await app.register(configPlugin)

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true)
      if (origin === app.config.WEB_ORIGIN) return cb(null, true)
      if (origin.startsWith('chrome-extension://')) return cb(null, true)
      cb(null, false)
    },
    credentials: true,
  })

  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
  })

  await app.register(secureSession, {
    sessionName: 'session',
    cookieName: 'kyomiru_sid',
    key: Buffer.from(app.config.SESSION_SECRET.padEnd(32, '0').slice(0, 32)),
    cookie: {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: app.config.NODE_ENV === 'production',
      maxAge: 30 * 24 * 3600,
    },
  })

  await app.register(dbPlugin)
  await app.register(redisPlugin)
  await app.register(enrichmentQueuePlugin)
  await app.register(authPlugin)
  await app.register(errorHandlerPlugin)

  // Routes under /api prefix
  await app.register(async (api) => {
    await api.register(authRoutes)
    await api.register(meRoutes)
    await api.register(servicesRoutes)
    await api.register(libraryRoutes)
    await api.register(showsRoutes)
    await api.register(queueRoutes)
    await api.register(newContentRoutes)
    await api.register(extensionRoutes)
    await api.register(providersRoutes)
  }, { prefix: '/api' })

  await app.register(healthzRoutes)

  return app
}
