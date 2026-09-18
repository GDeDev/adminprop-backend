import { createParamDecorator, ExecutionContext } from '@nestjs/common'

import { AuthenticatedUser } from '../types/jwt-payload.type'

/**
 * Inyecta el usuario autenticado en el handler.
 *
 * ```ts
 * @Get('me')
 * me(@CurrentUser() user: AuthenticatedUser) { ... }
 *
 * @Get('mi-id')
 * miId(@CurrentUser('id') userId: string) { ... }
 * ```
 *
 * En un endpoint marcado con `@IsPublic()` devuelve `undefined`.
 */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest()
    const user: AuthenticatedUser | undefined = request.user

    if (!user) return undefined
    return field ? user[field] : user
  },
)
