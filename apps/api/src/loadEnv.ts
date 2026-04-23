import { config } from 'dotenv'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
// apps/api/src/ → up 3 levels = monorepo root
const root = resolve(__dirname, '../../..')

// apps/api/.env takes precedence; root .env is the fallback
config({ path: resolve(root, 'apps/api/.env') })
config({ path: resolve(root, '.env') })
