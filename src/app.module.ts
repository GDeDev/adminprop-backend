import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'

import { AppController } from './app.controller'
import { AuthModule } from '@/modules/auth/infrastructure/modules/auth.module'
import { JwtAuthGuard } from '@/modules/auth/infrastructure/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/infrastructure/guards/roles.guard'
import { HealthModule } from '@/modules/health/infrastructure/modules/health.module'
import { QueueModule } from '@/platform/queue/queue.module'
import { PrismaModule } from '@/shared/prisma/prisma.module'
import { AppConfigModule } from './shared/config/config.module'
import { RequestContextMiddleware } from './shared/context/request-context.middleware'
import { AppLoggerModule } from './shared/logging/logger.module'
import { AppThrottlerGuard } from './shared/infra/throttler/app-throttler.guard'
import { AppThrottlerModule } from './shared/infra/throttler/throttler.module'
import { SharedModule } from './shared/shared.module'

@Module({
  imports: [
    // Va primero: valida el entorno antes de que nada más se instancie.
    AppConfigModule,
    AppLoggerModule,
    SharedModule,
    PrismaModule,
    // Habilita los @Cron. Hoy lo usa la limpieza de refresh tokens vencidos.
    ScheduleModule.forRoot(),
    AppThrottlerModule,
    AuthModule,
    // Infraestructura compartida (puertos de platform/).
    QueueModule,
    HealthModule,
    // Los módulos de cada feature van acá. Ver CLAUDE.md para la estructura.
  ],
  controllers: [AppController],
  providers: [
    // El orden importa: los guards globales corren en el orden en que se
    // registran acá.
    //
    // 1. Throttler — antes que nada, para que un atacante no pueda quemar CPU
    //    en verificaciones de JWT ni en bcrypt.
    // 2. JwtAuthGuard — autenticación. Cierra por defecto: todo requiere token
    //    salvo lo marcado con @IsPublic().
    // 3. RolesGuard — autorización. Necesita el usuario que dejó el guard
    //    anterior, así que va después.
    { provide: APP_GUARD, useClass: AppThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Abre el RequestContext y asigna el correlation ID. Va como middleware
    // porque corre antes que los guards: así hasta un 429 o un 401 salen con su
    // x-correlation-id y quedan logueados con contexto.
    consumer.apply(RequestContextMiddleware).forRoutes('*')
  }
}
