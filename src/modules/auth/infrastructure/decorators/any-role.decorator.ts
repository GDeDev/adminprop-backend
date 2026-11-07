import { SetMetadata } from '@nestjs/common'

export const ANY_ROLE_KEY = 'anyRole'

/**
 * Declara que un endpoint autenticado es apto para cualquier rol (staff,
 * propietario o inquilino): `auth/me`, `change-password`, `logout-all`.
 *
 * Existe porque el `RolesGuard` cierra por defecto (D-195): un handler sin
 * `@Roles`, `@IsPublic` ni `@AnyRole` recibe 403. Tener que escribir esto a
 * mano es lo que evita abrir una ruta a propietarios/inquilinos por olvido.
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true)
