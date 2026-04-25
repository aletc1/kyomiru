import { z } from 'zod'

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  APP_SECRET_KEY: z.string().min(1),
  SESSION_SECRET: z.string().min(1),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  OIDC_REDIRECT_URL: z.string().url().optional(),
  WEB_ORIGIN: z.string().url(),
  API_ORIGIN: z.string().url(),
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  TMDB_API_KEY: z.string().optional(),
  ENRICHMENT_LOCALES: z.string().optional().default('en-US,ja-JP,es-ES,fr-FR').transform(
    (s) => s.split(',').map((l) => l.trim()).filter(Boolean),
  ),
  ENRICHMENT_CONCURRENCY: z.coerce.number().int().positive().default(3),
  SHOW_REFRESH_CONCURRENCY: z.coerce.number().int().positive().default(3),
  PROVIDERS_FIXTURE: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  MOCK_GOOGLE_AUTH_USER: z.string().email().optional(),
  DISABLE_AUTO_SIGNUP: z.enum(['true', 'false']).default('false').transform((v) => v === 'true'),
  AUTO_SIGNUP_EMAIL_PATTERN: z.string().trim().optional(),
}).refine(
  (env) => !!env.MOCK_GOOGLE_AUTH_USER || (env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.OIDC_REDIRECT_URL),
  { message: 'GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and OIDC_REDIRECT_URL are required unless MOCK_GOOGLE_AUTH_USER is set' },
)

export type Env = z.infer<typeof EnvSchema>

export function validateEnv(): Env {
  const result = EnvSchema.safeParse(process.env)
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.flatten().fieldErrors)
    process.exit(1)
  }
  return result.data
}
