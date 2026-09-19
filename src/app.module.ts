import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'
import { ScheduleModule } from '@nestjs/schedule'

import { AppController } from './app.controller'
import { AuthModule } from '@/modules/auth/infrastructure/modules/auth.module'
import { JwtAuthGuard } from '@/modules/auth/infrastructure/guards/jwt-auth.guard'
import { RolesGuard } from '@/modules/auth/infrastructure/guards/roles.guard'
import { HealthModule } from '@/modules/health/infrastructure/modules/health.module'
import { JobsModule } from '@/modules/jobs/public'
import { TenantsModule } from '@/modules/tenants/public'
import { MasterDataModule } from '@/modules/master-data/public'
import { ExampleModule } from '@/modules/_example/public'
import { ExampleListenerModule } from '@/modules/_example-listener/infrastructure/modules/example-listener.module'
import { QueueModule } from '@/platform/queue/queue.module'
import { StorageModule } from '@/platform/storage/storage.module'
import { FeatureFlagsModule } from '@/platform/feature-flags/feature-flags.module'
import { EmailModule } from '@/platform/email/email.module'
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
    StorageModule,
    FeatureFlagsModule,
    EmailModule,
    HealthModule,
    JobsModule,
    TenantsModule,
    MasterDataModule,
    // Módulos de referencia (Fase 1). No se borran.
    ExampleModule,
    ExampleListenerModule,
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
