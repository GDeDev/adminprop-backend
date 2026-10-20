import { Global, Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'

import {
  AuthApplicationServices,
  AuthCommandHandlers,
  AuthQueryHandlers,
} from '@/modules/auth/application'
import { TenantsModule } from '@/modules/tenants/public'
import { AuthController } from '../http/controllers/auth.controller'
import { UsersController } from '../http/controllers/users.controller'
import { AuthRepositories } from '../repositories'
import { AuthTokenIssuer } from '../services/auth-token-issuer.service'
import { PasswordService } from '../services/password.service'
import { TokenService } from '../services/token.service'
import { RefreshTokenCleanupTask } from '../tasks/refresh-token-cleanup.task'

/**
 * Módulo de autenticación.
 *
 * Es `@Global()` porque `JwtAuthGuard` se registra como guard global en
 * `AppModule` y necesita `TokenService` y `UserRepository` inyectables desde
 * el contexto raíz.
 *
 * Exporta los servicios y repositorios, no los handlers: si otro módulo
 * necesita disparar un comando de auth, lo hace por el `CommandBus`.
 *
 * ## Si mañana esto se parte en microservicios
 *
 * Este módulo es el candidato natural a convertirse en el servicio de
 * identidad. Para que el resto de las APIs sigan validando tokens sin depender
 * de él, conviene:
 *  - pasar la firma de HS256 a RS256 y publicar un JWKS, así cada servicio
 *    valida con la clave pública y sólo el de identidad tiene la privada;
 *  - dejar el refresh/rotación exclusivamente en el servicio de identidad;
 *  - mantener `JwtAuthGuard` y los decoradores en una librería compartida.
 */
@Global()
@Module({
  imports: [
    // Sin secreto global: cada firma/verificación pasa el suyo explícito
    // (access y refresh usan secretos distintos). Ver `TokenService`.
    JwtModule.register({}),
    // El login de portal resuelve la inmobiliaria por slug con su facade.
    TenantsModule,
  ],
  controllers: [AuthController, UsersController],
  providers: [
    ...AuthRepositories,
    PasswordService,
    TokenService,
    AuthTokenIssuer,
    RefreshTokenCleanupTask,
    ...AuthApplicationServices,
    ...AuthCommandHandlers,
    ...AuthQueryHandlers,
  ],
  exports: [...AuthRepositories, PasswordService, TokenService],
})
export class AuthModule {}
