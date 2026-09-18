/**
 * Punto de entrada público del módulo de auth.
 * Los controllers de tus features deberían importar desde acá.
 */
export { AuthModule } from './modules/auth.module'
export { IsPublic, IS_PUBLIC_KEY } from './decorators/is-public.decorator'
export { Roles, ROLES_KEY } from './decorators/roles.decorator'
export { CurrentUser } from './decorators/current-user.decorator'
export { JwtAuthGuard } from './guards/jwt-auth.guard'
export { RolesGuard } from './guards/roles.guard'
export {
  AuthenticatedUser,
  AccessTokenPayload,
  RefreshTokenPayload,
} from './types/jwt-payload.type'
export { Role } from '@/domain/auth/enums/role.enum'
