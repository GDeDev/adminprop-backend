import { SetMetadata } from '@nestjs/common'

export const ANY_ROLE_KEY = 'anyRole'

/**
 * Declara que un endpoint autenticado es a propósito para cualquier rol,
 * incluidos los de portal (OWNER y RENTER): `me`, cambio de contraseña, etc.
 *
 * Existe porque el `RolesGuard` rechaza a los roles de portal en todo endpoint
 * que no declare `@Roles(...)`, `@AnyRole()` o `@IsPublic()`. Así, olvidarse
 * de proteger un controller nuevo no lo deja abierto a propietarios e
 * inquilinos, que comparten tenant con el personal.
 */
export const AnyRole = () => SetMetadata(ANY_ROLE_KEY, true)
