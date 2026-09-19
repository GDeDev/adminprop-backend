import { NestFactory } from '@nestjs/core'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Exporta el contrato OpenAPI a `openapi.json`, sin base de datos ni Doppler.
 *
 *   npm run openapi:export
 *
 * El frontend genera sus tipos desde ese archivo (`npm run api:types` en
 * adminprop-frontend). Se commitea: así cada PR muestra cómo cambió el
 * contrato, y el CI falla si alguien cambió un DTO sin regenerarlo.
 *
 * Arma la app en modo `preview`: registra módulos y rutas pero no instancia
 * providers, así no se conecta a Postgres ni a pg-boss. La validación de
 * entorno igual corre, y se le pasan valores descartables sólo si faltan: el
 * documento no depende de ninguno.
 */
const PLACEHOLDER_ENV: Record<string, string> = {
  DATABASE_URL: 'postgresql://openapi:openapi@localhost:5432/openapi_export',
  JWT_ACCESS_SECRET: 'openapi-export-access-secret-descartable-32-chars',
  JWT_REFRESH_SECRET: 'openapi-export-refresh-secret-descartable-32-chars',
  FEATURE_FLAGS_PROVIDER: 'memory',
  STORAGE_PROVIDER: 'local',
  EMAIL_PROVIDER: 'console',
}

async function main(): Promise<void> {
  for (const [key, value] of Object.entries(PLACEHOLDER_ENV)) {
    process.env[key] ??= value
  }

  // Import diferido: la config se evalúa al importar el módulo, y tiene que
  // ver el entorno ya completo.
  const { AppModule } = await import('../src/app.module')
  const { buildOpenApiDocument, configureVersioning } =
    await import('../src/app.setup')

  const app = await NestFactory.create(AppModule, {
    preview: true,
    logger: false,
  })
  configureVersioning(app)

  const document = buildOpenApiDocument(app)
  const output = resolve(__dirname, '..', 'openapi.json')
  writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)

  await app.close()
  console.log(`✅ OpenAPI exportado a ${output}`)
}

main().catch((error: unknown) => {
  console.error('❌ No se pudo exportar el OpenAPI:', error)
  process.exit(1)
})
