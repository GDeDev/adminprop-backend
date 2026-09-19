import { INestApplication, VersioningType } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import compression from 'compression'
import helmet from 'helmet'
import { json, urlencoded } from 'express'
import { resolve } from 'node:path'

import {
  AppConfig,
  Configuration,
  CorsConfig,
  StorageConfig,
} from './shared/config/configuration'
import { StorageProvider } from './shared/config/env.validation'
import { LOCAL_FILES_ROUTE } from '@/platform/storage/adapters/local.storage-adapter'
import { Logger } from 'nestjs-pino'

import { createLogger } from '@/shared/logging/root-logger'
import { GlobalExceptionFilter } from './shared/infra/filters/global-exception.filter'
import { PrismaExceptionFilter } from './shared/infra/filters/prisma-exception.filter'
import { CustomValidationPipe } from './shared/infra/pipes/custom-validation.pipe'

/**
 * Configuración de la aplicación, separada de `main.ts` a propósito.
 *
 * Los tests e2e llaman a esta misma función, así prueban la app con los mismos
 * pipes, filtros y middlewares que corren en producción. Si esto viviera dentro
 * de `bootstrap()`, los e2e probarían una app distinta de la real —que es la
 * forma clásica de que un bug de serialización de errores pase los tests—.
 */
export function configureApp(app: NestExpressApplication): AppConfig {
  const logger = createLogger('Bootstrap')
  const configService =
    app.get<ConfigService<Configuration, true>>(ConfigService)
  const appConfig = configService.get('app', { infer: true })
  const corsConfig = configService.get('cors', { infer: true })
  const storageConfig = configService.get('storage', { infer: true })

  // Los logs del propio Nest (RoutesResolver, InstanceLoader, errores de
  // arranque) pasan a salir con el mismo formato que los nuestros.
  // `flushLogs` es obligatorio con `bufferLogs: true`: sin él, todo lo que Nest
  // retuvo durante el arranque nunca se emite.
  app.useLogger(app.get(Logger))
  app.flushLogs()

  configureSecurity(app, appConfig, corsConfig, logger)
  configureRequestHandling(app, appConfig)
  configureVersioning(app)
  configureSwagger(app, appConfig)
  configureLocalStorage(app, storageConfig)

  return appConfig
}

/**
 * Con `STORAGE_PROVIDER=local`, sirve la carpeta de archivos en `/files`,
 * que es la URL que devuelve el adapter. Con Cloudinary no hace nada: los
 * archivos los sirve su CDN.
 */
function configureLocalStorage(
  app: NestExpressApplication,
  storage: StorageConfig,
): void {
  if (storage.provider !== StorageProvider.Local) return

  app.useStaticAssets(resolve(storage.local.directory), {
    prefix: LOCAL_FILES_ROUTE,
    index: false,
    dotfiles: 'deny',
    // helmet manda `Cross-Origin-Resource-Policy: same-origin`, que impide
    // mostrar estas imágenes desde el front (otro puerto = otro origen).
    setHeaders: (res) =>
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
}

function configureSecurity(
  app: NestExpressApplication,
  appConfig: AppConfig,
  corsConfig: CorsConfig,
  logger: ReturnType<typeof createLogger>,
): void {
  app.use(
    helmet({
      // La API no sirve HTML, así que la CSP por defecto de helmet no aporta
      // nada. La excepción es Swagger, que necesita cargar sus propios assets.
      contentSecurityPolicy: appConfig.swaggerEnabled ? false : undefined,
      crossOriginEmbedderPolicy: false,
      hsts: appConfig.isProduction
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    }),
  )

  // CORS cerrado por defecto: sin CORS_ORIGINS no se habilita ningún origen.
  // El `app.enableCors()` sin argumentos que traía el template dejaba entrar a
  // cualquier sitio.
  if (corsConfig.origins === false) {
    logger.warn(
      'CORS deshabilitado: no hay CORS_ORIGINS configurado. Si consumís esta API desde un navegador, definila.',
    )
  } else {
    if (corsConfig.origins === true && appConfig.isProduction) {
      logger.warn(
        '⚠️  CORS_ORIGINS="*" en producción: cualquier sitio puede llamar a esta API. Listá los orígenes permitidos.',
      )
    }

    app.enableCors({
      origin: corsConfig.origins,
      credentials: corsConfig.credentials,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'x-correlation-id',
        'x-request-id',
      ],
      exposedHeaders: ['x-correlation-id', 'Retry-After'],
      maxAge: 86_400,
    })
  }

  // Detrás de un balanceador, sin esto `req.ip` es la IP del proxy y el rate
  // limiting contaría todo el tráfico como un solo cliente.
  if (appConfig.trustProxy) {
    app.set('trust proxy', 1)
  }

  // No regalar la tecnología del backend.
  app.disable('x-powered-by')
}

function configureRequestHandling(
  app: NestExpressApplication,
  appConfig: AppConfig,
): void {
  app.use(compression())

  // Límite explícito de payload: sin tope, un body gigante es un DoS barato.
  app.use(json({ limit: appConfig.bodyLimit }))
  app.use(urlencoded({ extended: true, limit: appConfig.bodyLimit }))

  app.useGlobalPipes(new CustomValidationPipe())

  // Nest evalúa los filtros del último al primero: el de Prisma, más
  // específico, va después del catch-all para que lo gane.
  // Se resuelven del contenedor y no con : necesitan el logger inyectado.
  // El orden se mantiene explícito porque Nest evalúa los filtros del último al
  // primero, y el de Prisma —más específico— tiene que ganarle al catch-all.
  app.useGlobalFilters(
    app.get(GlobalExceptionFilter),
    app.get(PrismaExceptionFilter),
  )
}

function configureVersioning(app: INestApplication): void {
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
    prefix: 'api/v',
  })
}

function configureSwagger(app: INestApplication, appConfig: AppConfig): void {
  if (!appConfig.swaggerEnabled) return

  const config = new DocumentBuilder()
    .setTitle(appConfig.name)
    .setDescription(
      'API NestJS con arquitectura hexagonal, CQRS y autenticación JWT propia.',
    )
    .setVersion('1.0')
    .addBearerAuth({
      bearerFormat: 'JWT',
      type: 'http',
      scheme: 'bearer',
      description: 'Access token devuelto por POST /api/v1/auth/login',
    })
    .build()

  const document = SwaggerModule.createDocument(app, config)

  SwaggerModule.setup('swagger', app, document, {
    swaggerOptions: {
      persistAuthorization: true,
      defaultModelsExpandDepth: -1,
    },
  })
}
