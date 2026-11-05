import 'reflect-metadata'

import {
  applyDemoSeedEnvironment,
  assertDemoSeedAllowed,
  DemoSeedRefusedError,
} from './demo-guards'

/**
 * `npm run seed:demo`: carga datos de demo (dos inmobiliarias ficticias con
 * personas, propiedades, contratos, cobros y liquidaciones). Ver
 * docs/SEED_DEMO.md.
 *
 * Orden de las cosas, y por qué:
 * 1. Las guardas corren ANTES de importar la app: si el entorno no es de
 *    desarrollo, no se levanta nada ni se abre ninguna conexión.
 * 2. Se fuerzan proveedores locales (cola en memoria, mails por consola,
 *    storage local...) antes de importar `AppModule`, que lee el entorno.
 * 3. La app se levanta como contexto sin HTTP: no escucha en ningún puerto.
 */
async function main(): Promise<void> {
  assertDemoSeedAllowed({
    nodeEnv: process.env.NODE_ENV,
    databaseUrl: process.env.DATABASE_URL,
  })
  applyDemoSeedEnvironment(process.env)

  const [
    { NestFactory },
    { AppModule },
    { runDemoSeed },
    { formatDemoSummary },
  ] = await Promise.all([
    import('@nestjs/core'),
    import('@/app.module'),
    import('./run-demo-seed'),
    import('./demo-summary'),
  ])

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  })
  try {
    const report = await runDemoSeed(app, {
      log: (message) => console.log(message),
    })
    console.log(formatDemoSummary(report))
  } finally {
    await app.close()
  }
}

main().catch((error: unknown) => {
  if (error instanceof DemoSeedRefusedError) {
    console.error(`\n❌ ${error.message}\n`)
    process.exit(2)
  }
  console.error('❌ Falló el seed de demo:', error)
  process.exit(1)
})
