import type { AuthenticatedUser } from '@/modules/auth/public'

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
