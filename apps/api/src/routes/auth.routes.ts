import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import * as oidcClient from 'openid-client'
import { users } from '@kyomiru/db/schema'
import { randomUUID } from 'node:crypto'
import { isEmailApproved } from '../services/authGate.js'

async function signInAs(
  app: FastifyInstance,
  req: FastifyRequest,
  reply: FastifyReply,
  profile: { googleSub: string; email: string; displayName: string; avatarUrl: string | null },
) {
  if (!(await isEmailApproved(app, profile.email))) {
    const params = new URLSearchParams({ email: profile.email })
    return reply.redirect(`${app.config.WEB_ORIGIN}/unauthorized?${params}`)
  }

  const [user] = await app.db
    .insert(users)
    .values({
      googleSub: profile.googleSub,
      email: profile.email,
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.googleSub,
      set: {
        email: profile.email,
        displayName: profile.displayName,
        avatarUrl: profile.avatarUrl,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning()

  if (!user) throw new Error('Failed to upsert user')

  const sessionId = randomUUID()
  req.session.set('userId', user.id)
  req.session.set('sessionId', sessionId)
  req.session.set('email', user.email)
  await app.redis.setex(`session:${sessionId}`, 30 * 24 * 3600, user.id)
  reply.redirect(`${app.config.WEB_ORIGIN}/library`)
}

export async function authRoutes(app: FastifyInstance) {
  // Initiate Google OIDC (or mock sign-in when MOCK_GOOGLE_AUTH_USER is set)
  app.get('/auth/google', async (req, reply) => {
    const mockEmail = app.config.MOCK_GOOGLE_AUTH_USER
    if (mockEmail) {
      app.log.warn({ mockEmail }, 'Bypassing Google OIDC — signing in as mock user')
      return signInAs(app, req, reply, {
        googleSub: `mock:${mockEmail}`,
        email: mockEmail,
        displayName: mockEmail.split('@')[0] ?? mockEmail,
        avatarUrl: null,
      })
    }
    const params = oidcClient.buildAuthorizationUrl(
      app.oidcConfig!,
      new URLSearchParams({
        redirect_uri: app.config.OIDC_REDIRECT_URL!,
        scope: 'openid email profile',
        response_type: 'code',
        state: randomUUID(),
      }),
    )
    reply.redirect(params.href)
  })

  // Callback from Google
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/auth/callback',
    async (req, reply) => {
      if (req.query.error) {
        return reply.redirect(`${app.config.WEB_ORIGIN}/login?error=${req.query.error}`)
      }
      try {
        const tokens = await oidcClient.authorizationCodeGrant(
          app.oidcConfig!,
          new URL(req.url, app.config.API_ORIGIN),
          req.query.state ? { expectedState: req.query.state } : {},
        )
        const claims = tokens.claims()
        if (!claims?.sub || !claims.email) throw new Error('Missing claims')

        await signInAs(app, req, reply, {
          googleSub: claims.sub,
          email: claims.email as string,
          displayName: (claims.name as string | undefined) ?? (claims.email as string),
          avatarUrl: (claims.picture as string | undefined) ?? null,
        })
      } catch (err) {
        app.log.error(err)
        reply.redirect(`${app.config.WEB_ORIGIN}/login?error=auth_failed`)
      }
    },
  )

  app.post('/auth/logout', async (req, reply) => {
    const sessionId = req.session.get('sessionId')
    if (sessionId) await app.redis.del(`session:${sessionId}`)
    req.session.delete()
    reply.send({ ok: true })
  })
}
