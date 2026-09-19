import { SetMetadata } from '@nestjs/common'

export const IS_PUBLIC_KEY = 'isPublic'

/**
 * Marca un endpoint (o un controller entero) como accesible sin token.
 *
 * El `JwtAuthGuard` está registrado como guard global: **todo** requiere
 * autenticación salvo lo que marques con este decorador. Es a propósito —
 * olvidarte de proteger un endpoint nuevo no debería ser posible.
 *
 * ```ts
 * @IsPublic()
 * @Post('login')
 * login() { ... }
 * ```
 */
export const IsPublic = () => SetMetadata(IS_PUBLIC_KEY, true)
