/**
 * Catálogo de códigos de error de la API.
 *
 * El `code` es el contrato estable con los clientes: el `message` puede
 * cambiar o traducirse, el `code` no. Frontend y otros servicios deberían
 * ramificar por `code`, nunca por el texto del mensaje.
 */
export enum ErrorCode {
  // ------------------------------------------------------------------ Genéricos
  INTERNAL_ERROR = 'INTERNAL_ERROR',
  BAD_REQUEST = 'BAD_REQUEST',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  UNPROCESSABLE_ENTITY = 'UNPROCESSABLE_ENTITY',
  PAYLOAD_TOO_LARGE = 'PAYLOAD_TOO_LARGE',
  UNSUPPORTED_MEDIA_TYPE = 'UNSUPPORTED_MEDIA_TYPE',
  METHOD_NOT_ALLOWED = 'METHOD_NOT_ALLOWED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  REQUEST_TIMEOUT = 'REQUEST_TIMEOUT',

  // --------------------------------------------------------- Autenticación / sesión
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_MISSING = 'TOKEN_MISSING',
  TOKEN_INVALID = 'TOKEN_INVALID',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  REFRESH_TOKEN_INVALID = 'REFRESH_TOKEN_INVALID',
  REFRESH_TOKEN_EXPIRED = 'REFRESH_TOKEN_EXPIRED',
  /** Se usó un refresh token ya rotado: posible robo de token. */
  REFRESH_TOKEN_REUSED = 'REFRESH_TOKEN_REUSED',
  SESSION_REVOKED = 'SESSION_REVOKED',

  // --------------------------------------------------------------------- Cuentas
  EMAIL_ALREADY_REGISTERED = 'EMAIL_ALREADY_REGISTERED',
  ACCOUNT_INACTIVE = 'ACCOUNT_INACTIVE',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  WEAK_PASSWORD = 'WEAK_PASSWORD',
  CURRENT_PASSWORD_INVALID = 'CURRENT_PASSWORD_INVALID',
  PASSWORD_REUSED = 'PASSWORD_REUSED',

  // ---------------------------------------------------------------- Autorización
  FORBIDDEN = 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS = 'INSUFFICIENT_PERMISSIONS',

  // --------------------------------------------------------------- Base de datos
  DATABASE_ERROR = 'DATABASE_ERROR',
  UNIQUE_CONSTRAINT_VIOLATION = 'UNIQUE_CONSTRAINT_VIOLATION',
  FOREIGN_KEY_CONSTRAINT_VIOLATION = 'FOREIGN_KEY_CONSTRAINT_VIOLATION',
  RECORD_NOT_FOUND = 'RECORD_NOT_FOUND',
  RELATED_RECORDS_EXIST = 'RELATED_RECORDS_EXIST',

  // ------------------------------------------------------------ Servicios externos
  EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
  EXTERNAL_SERVICE_TIMEOUT = 'EXTERNAL_SERVICE_TIMEOUT',
  EXTERNAL_SERVICE_UNAVAILABLE = 'EXTERNAL_SERVICE_UNAVAILABLE',
}

/** Detalle por campo dentro de una respuesta de error. */
export interface ErrorDetail {
  message: string
  code?: string
  field?: string
}
