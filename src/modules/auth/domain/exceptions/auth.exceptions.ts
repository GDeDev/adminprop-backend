import { AppException } from '@/shared/errors/app.exception'
import { ErrorCode } from '@/shared/errors/error-codes'

/**
 * Excepciones de autenticación.
 *
 * Criterio: los errores de login son deliberadamente vagos. No distinguimos
 * "ese email no existe" de "la contraseña está mal" porque eso le permitiría a
 * un atacante enumerar qué cuentas existen. El detalle real va al log.
 */
export const AuthErrors = {
  invalidCredentials: (metadata?: Record<string, unknown>) =>
    AppException.unauthorized(
      'Email o contraseña incorrectos',
      ErrorCode.INVALID_CREDENTIALS,
      { metadata },
    ),

  emailAlreadyRegistered: () =>
    AppException.conflict(
      'Ya existe una cuenta registrada con ese email',
      ErrorCode.EMAIL_ALREADY_REGISTERED,
      {
        details: [
          {
            field: 'email',
            code: ErrorCode.EMAIL_ALREADY_REGISTERED,
            message: 'Ese email ya está en uso',
          },
        ],
      },
    ),

  accountInactive: () =>
    AppException.forbidden(
      'La cuenta está desactivada. Contactá al administrador.',
      ErrorCode.ACCOUNT_INACTIVE,
    ),

  accountLocked: (until: Date) =>
    AppException.forbidden(
      'La cuenta está bloqueada temporalmente por demasiados intentos fallidos',
      ErrorCode.ACCOUNT_LOCKED,
      { metadata: { lockedUntil: until.toISOString() } },
    ),

  tokenMissing: () =>
    AppException.unauthorized(
      'Falta el token de autenticación',
      ErrorCode.TOKEN_MISSING,
    ),

  tokenInvalid: (metadata?: Record<string, unknown>) =>
    AppException.unauthorized(
      'El token de autenticación no es válido',
      ErrorCode.TOKEN_INVALID,
      { metadata },
    ),

  tokenExpired: () =>
    AppException.unauthorized(
      'El token de autenticación expiró',
      ErrorCode.TOKEN_EXPIRED,
    ),

  refreshTokenInvalid: (metadata?: Record<string, unknown>) =>
    AppException.unauthorized(
      'El refresh token no es válido',
      ErrorCode.REFRESH_TOKEN_INVALID,
      { metadata },
    ),

  refreshTokenExpired: () =>
    AppException.unauthorized(
      'El refresh token expiró. Volvé a iniciar sesión.',
      ErrorCode.REFRESH_TOKEN_EXPIRED,
    ),

  refreshTokenReused: (metadata?: Record<string, unknown>) =>
    AppException.unauthorized(
      'Se detectó el reuso de un refresh token. Se cerraron todas las sesiones por seguridad.',
      ErrorCode.REFRESH_TOKEN_REUSED,
      { metadata },
    ),

  sessionRevoked: () =>
    AppException.unauthorized(
      'La sesión fue revocada. Volvé a iniciar sesión.',
      ErrorCode.SESSION_REVOKED,
    ),

  currentPasswordInvalid: () =>
    AppException.badRequest(
      'La contraseña actual es incorrecta',
      ErrorCode.CURRENT_PASSWORD_INVALID,
      {
        details: [
          {
            field: 'currentPassword',
            code: ErrorCode.CURRENT_PASSWORD_INVALID,
            message: 'La contraseña actual es incorrecta',
          },
        ],
      },
    ),

  passwordReused: () =>
    AppException.badRequest(
      'La contraseña nueva tiene que ser distinta de la actual',
      ErrorCode.PASSWORD_REUSED,
      {
        details: [
          {
            field: 'newPassword',
            code: ErrorCode.PASSWORD_REUSED,
            message: 'Elegí una contraseña distinta de la actual',
          },
        ],
      },
    ),

  insufficientPermissions: (required: string[]) =>
    AppException.forbidden(
      'No tenés permisos para realizar esta acción',
      ErrorCode.INSUFFICIENT_PERMISSIONS,
      { metadata: { requiredRoles: required } },
    ),
}
