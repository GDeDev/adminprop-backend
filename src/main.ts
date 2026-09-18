import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { loadSecrets } from './shared/config/secrets/load-secrets'
import { createLogger, flushLogger } from '@/shared/logging/root-logger'

async function bootstrap() {
  // Los secretos se cargan antes de instanciar Nest: cuando corre la validación
  // de entorno ya tienen que estar todos en process.env.
  await loadSecrets()

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    // Retiene los logs de arranque hasta que `configureApp` llama a
    // `useLogger`, y recién ahí los emite. Sin esto, todo lo anterior a ese
    // punto (InstanceLoader, errores de instanciación) sale con el formato
    // default de Nest y rompe el parseo del agregador.
    bufferLogs: true,
  })

  const appConfig = configureApp(app)

  // Le da a Nest la chance de cerrar conexiones (Prisma, colas) al recibir
  // SIGTERM. Sin esto, un deploy corta requests en vuelo.
  app.enableShutdownHooks()

  await app.listen(appConfig.port)

  createLogger('Bootstrap').info(
    {
      environment: appConfig.env,
      swagger: appConfig.swaggerEnabled ? '/swagger' : 'deshabilitado',
    },
    `🚀 Aplicación escuchando en el puerto ${appConfig.port}`,
  )
}

bootstrap().catch(async (error) => {
  // Falla al arrancar (entorno inválido, base caída): que muera fuerte y
  // visible, no en un estado a medias.
  //
  // Se usa console.error y no el logger a propósito: si lo que falló fue la
  // propia construcción del logger, el mensaje tiene que salir igual.
  console.error('❌ No se pudo iniciar la aplicación:')
  console.error(error instanceof Error ? error.message : error)

  // Vacía lo que pino tenga pendiente, que con `bufferLogs` son justo los logs
  // de arranque que explican la falla.
  await flushLogger()

  process.exit(1)
})
