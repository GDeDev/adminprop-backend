import { PrismaClient } from '@prisma/client'

import { TEST_DATABASE_URL } from './test-database-url'

export interface WaitForOptions {
  timeoutMs?: number
  intervalMs?: number
  /**
   * Qué se espera, en palabras ("evento settlement-confirmed de la
   * liquidación X"). Va en el mensaje de error: sin esto, el timeout sólo dice
   * que "la condición no se cumplió".
   */
  what?: string
}

/**
 * Espera a que `condition` se cumpla, reintentando cada `intervalMs`.
 *
 * Para los e2e de la cola: el consumidor corre en otro ciclo de polling y no
 * hay un evento al que engancharse. Si se agota el tiempo, el error describe lo
 * que se esperaba y vuelca el estado de `pgboss.job`, que distingue "nadie
 * tomó el mensaje" de "se tomó y falló".
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 15_000, intervalMs = 100, what }: WaitForOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  const subject = what ? `"${what}"` : 'la condición'
  throw new Error(
    `waitFor: ${subject} no se cumplió en ${timeoutMs}ms\n` +
      (await describeQueueState()),
  )
}

/** Resumen de `pgboss.job` para el mensaje de error. Nunca tira. */
export async function describeQueueState(): Promise<string> {
  const prisma = new PrismaClient({
    datasourceUrl: TEST_DATABASE_URL,
  })
  try {
    const counts = await prisma.$queryRawUnsafe<
      { name: string; state: string; total: number }[]
    >(
      `SELECT name, state::text AS state, count(*)::int AS total
         FROM pgboss.job GROUP BY name, state ORDER BY name, state`,
    )
    const failures = await prisma.$queryRawUnsafe<
      { name: string; state: string; retry_count: number; output: unknown }[]
    >(
      `SELECT name, state::text AS state, retry_count, output
         FROM pgboss.job WHERE state IN ('retry', 'failed')
         ORDER BY created_on DESC LIMIT 5`,
    )
    const lines = counts.length
      ? counts.map((row) => `  ${row.name} [${row.state}]: ${row.total}`)
      : ['  (pgboss.job está vacía: nadie publicó el mensaje)']
    const failed = failures.map(
      (row) =>
        `  ${row.name} [${row.state}] reintento ${row.retry_count}: ` +
        JSON.stringify(row.output),
    )
    return [
      'Estado de pgboss.job:',
      ...lines,
      ...(failed.length ? ['Últimos fallos:', ...failed] : []),
    ].join('\n')
  } catch (error) {
    return `(no se pudo leer pgboss.job: ${String(error)})`
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}
