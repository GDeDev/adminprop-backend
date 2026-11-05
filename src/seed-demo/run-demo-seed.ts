import { INestApplicationContext } from '@nestjs/common'

import { todayIso } from '@/shared/dates/calendar-date'
import { demoCalendar } from './demo-calendar'
import { buildDemoPlan } from './demo-plan'
import { DemoRunReport, DemoSeeder } from './demo-seeder'

export interface RunDemoSeedOptions {
  /** Fecha de "hoy" (`AAAA-MM-DD`); por defecto la real. Los tests la fijan. */
  today?: string
  log?: (message: string) => void
}

/**
 * Corre el seed sobre una app de Nest ya levantada. Lo usan `main.ts` (el
 * script `npm run seed:demo`) y el e2e. Las guardas de entorno NO van acá sino
 * en `main.ts`: el e2e corre bajo NODE_ENV=test contra su base `_test`.
 */
export async function runDemoSeed(
  app: INestApplicationContext,
  options: RunDemoSeedOptions = {},
): Promise<DemoRunReport> {
  const calendar = demoCalendar(options.today ?? todayIso())
  const seeder = new DemoSeeder(app, calendar, options.log)
  const report = await seeder.run(buildDemoPlan(calendar))

  return report
}
