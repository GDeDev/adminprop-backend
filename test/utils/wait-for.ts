/**
 * Espera a que `condition` se cumpla, reintentando cada `intervalMs`.
 *
 * Para los e2e de la cola: el consumidor corre en otro ciclo de polling y no
 * hay un evento al que engancharse.
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  { timeoutMs = 15_000, intervalMs = 100 } = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  throw new Error(`waitFor: la condición no se cumplió en ${timeoutMs}ms`)
}
