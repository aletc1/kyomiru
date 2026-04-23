import './src/loadEnv.js'
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'] ?? 'postgresql://kyomiru:kyomiru@localhost:5432/kyomiru',
  },
})
