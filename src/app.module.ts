import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'

import { AppController } from './app.controller'
import { ExampleModule } from './infrastructure/example/modules/example.module'
import { AuthModule } from './infrastructure/auth/modules/auth.module'
import { JwtAuthGuard } from './infrastructure/auth/guards/jwt-auth.guard'
import { RolesGuard } from './infrastructure/auth/guards/roles.guard'
import { HealthModule } from './infrastructure/health/modules/health.module'
import { PrismaModule } from './infrastructure/prisma/prisma.module'
import { AppConfigModule } from './shared/config/config.module'
import { AppLoggerInterceptor } from './shared/infra/interceptors/app-logger.interceptor'
import { CorrelationIdMiddleware } from './shared/infra/middleware/correlation-id.middleware'
import { AppThrottlerGuard } from './shared/infra/throttler/app-throttler.guard'
import { AppThrottlerModule } from './shared/infra/throttler/throttler.module'
import { SharedModule } from './shared/shared.module'

@Module({
  imports: [
    // Va primero: valida el entorno antes de que nada más se instancie.
    AppConfigModule,
    SharedModule,
    PrismaModule,
    // Habilita los @Cron. Hoy lo usa la limpieza de refresh tokens vencidos.
    ScheduleModule.forRoot(),
    AppThrottlerModule,
    AuthModule,
    HealthModule,
    ExampleModule,
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
    { provide: APP_INTERCEPTOR, useClass: AppLoggerInterceptor },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    // Como middleware corre antes que los guards, así que hasta un 429 o un 401
    // sale con su x-correlation-id.
    consumer.apply(CorrelationIdMiddleware).forRoutes('*')
  }
}
