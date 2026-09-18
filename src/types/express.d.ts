import { AuthenticatedUser } from '@/infrastructure/auth/types/jwt-payload.type'

/**
 * Suma `request.user` al tipo Request de Express.
 * Lo completa `JwtAuthGuard` y se lee con el decorador `@CurrentUser()`.
 */
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser
    }
  }
}

export {}
