import { NestFactory } from '@nestjs/core'
import { NestExpressApplication } from '@nestjs/platform-express'

import { AppModule } from './app.module'
import { configureApp } from './app.setup'
import { loadSecrets } from './shared/config/secrets/load-secrets'
import { CustomLoggerService } from './shared/core/logger.service'

async function bootstrap() {
  // Los secretos se cargan antes de instanciar Nest: cuando corre la validación
  // de entorno ya tienen que estar todos en process.env.
  await loadSecrets()

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  })

  const appConfig = configureApp(app)

  // Le da a Nest la chance de cerrar conexiones (Prisma, colas) al recibir
  // SIGTERM. Sin esto, un deploy corta requests en vuelo.
  app.enableShutdownHooks()

  await app.listen(appConfig.port)

  new CustomLoggerService('Bootstrap').log(
    `🚀 Aplicación escuchando en el puerto ${appConfig.port}`,
    {
      environment: appConfig.env,
      swagger: appConfig.swaggerEnabled ? '/swagger' : 'deshabilitado',
    },
  )
}

bootstrap().catch((error) => {
  // Falla al arrancar (entorno inválido, base caída): que muera fuerte y
  // visible, no en un estado a medias.
  console.error('❌ No se pudo iniciar la aplicación:')
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
