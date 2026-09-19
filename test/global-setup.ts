import { execSync } from 'node:child_process'

import {
  assertIsTestDatabase,
  TEST_DATABASE_URL,
} from './utils/test-database-url'

/**
 * Corre una vez antes de todos los e2e: deja la base de tests con las
 * migraciones al día. Postgres tiene que estar levantado (`npm run docker:dev`
 * en local; un service del workflow en CI).
 */
export default function globalSetup(): void {
  assertIsTestDatabase(TEST_DATABASE_URL)

  execSync('npx prisma migrate deploy', {
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  })
}
