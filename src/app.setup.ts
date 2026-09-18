import { INestApplication, VersioningType } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { NestExpressApplication } from '@nestjs/platform-express'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import * as compression from 'compression'
import helmet from 'helmet'
import { json, urlencoded } from 'express'

import {
  AppConfig,
  Configuration,
  CorsConfig,
} from './shared/config/configuration'
import { CustomLoggerService } from './shared/core/logger.service'
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
  const logger = new CustomLoggerService('Bootstrap')
  const configService =
    app.get<ConfigService<Configuration, true>>(ConfigService)
  const appConfig = configService.get('app', { infer: true })
  const corsConfig = configService.get('cors', { infer: true })

  configureSecurity(app, appConfig, corsConfig, logger)
  configureRequestHandling(app, appConfig)
  configureVersioning(app)
  configureSwagger(app, appConfig)

  return appConfig
}

function configureSecurity(
  app: NestExpressApplication,
  appConfig: AppConfig,
  corsConfig: CorsConfig,
  logger: CustomLoggerService,
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
  app.useGlobalFilters(
    new GlobalExceptionFilter(appConfig.isProduction),
    new PrismaExceptionFilter(appConfig.isProduction),
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
