import { Role } from '@/modules/auth/domain/enums/role.enum'

export const TOKEN_TYPE_ACCESS = 'access'
export const TOKEN_TYPE_REFRESH = 'refresh'

interface BaseClaims {
  /** Subject: id del usuario. */
  sub: string
  iat?: number
  exp?: number
  iss?: string
  aud?: string
}

export interface AccessTokenPayload extends BaseClaims {
  typ: typeof TOKEN_TYPE_ACCESS
  email: string
  role: Role
  /** Inmobiliaria del usuario. De acá sale el filtro de tenant del request. */
  tenantId: string
}

export interface RefreshTokenPayload extends BaseClaims {
  typ: typeof TOKEN_TYPE_REFRESH
  /** Id único de este token, para auditar la cadena de rotaciones. */
  jti: string
  /** Familia de rotación: todos los tokens nacidos del mismo login. */
  fid: string
}

/**
 * Usuario autenticado que el guard deja en `request.user`.
 * Se obtiene con el decorador `@CurrentUser()`.
 */
export interface AuthenticatedUser {
  id: string
  email: string
  role: Role
  tenantId: string
}
