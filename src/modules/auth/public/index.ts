/**
 * API pública del módulo de auth: lo único que otros módulos pueden importar
 * de acá (spec Fase 1, sección 5.1; lo hace cumplir eslint-plugin-boundaries).
 *
 * Son las piezas para proteger y leer al usuario en un controller. Todo lo
 * demás (tokens, repositorios, handlers) es interno y puede cambiar el día que
 * auth se extraiga a su propio servicio.
 */
export { CurrentUser } from '../infrastructure/decorators/current-user.decorator'
export { IsPublic } from '../infrastructure/decorators/is-public.decorator'
export { Roles } from '../infrastructure/decorators/roles.decorator'
export type { AuthenticatedUser } from '../infrastructure/types/jwt-payload.type'
export { ALL_ROLES, Role } from '../domain/enums/role.enum'
