import { HttpException, HttpStatus } from '@nestjs/common'

import { ErrorCode, ErrorDetail } from './error-codes'

export interface AppExceptionOptions {
  /** Errores por campo, para que el frontend los muestre donde corresponde. */
  details?: ErrorDetail[]
  /** Error original. Se loguea, nunca se serializa al cliente. */
  cause?: unknown
  /** Contexto extra para los logs. Nunca se serializa al cliente. */
  metadata?: Record<string, unknown>
}

/**
 * Excepción base de la aplicación.
 *
 * Siempre lleva un `ErrorCode` estable además del status HTTP, así el cliente
 * puede distinguir, por ejemplo, un 401 por token vencido de un 401 por
 * credenciales inválidas.
 *
 * Usá los factories estáticos en vez del constructor: leen mejor en los
 * handlers y evitan elegir mal el status.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode
  readonly details: ErrorDetail[]
  readonly metadata?: Record<string, unknown>

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus,
    options: AppExceptionOptions = {},
  ) {
    super({ code, message }, status, { cause: options.cause })
    this.code = code
    this.details = options.details ?? []
    this.metadata = options.metadata
    this.name = 'AppException'
  }

  static badRequest(
    message: string,
    code: ErrorCode = ErrorCode.BAD_REQUEST,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(code, message, HttpStatus.BAD_REQUEST, options)
  }

  static validation(
    message: string,
    details: ErrorDetail[],
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(
      ErrorCode.VALIDATION_FAILED,
      message,
      HttpStatus.BAD_REQUEST,
      { ...options, details },
    )
  }

  static unauthorized(
    message: string,
    code: ErrorCode = ErrorCode.UNAUTHENTICATED,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(code, message, HttpStatus.UNAUTHORIZED, options)
  }

  static forbidden(
    message: string,
    code: ErrorCode = ErrorCode.FORBIDDEN,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(code, message, HttpStatus.FORBIDDEN, options)
  }

  static notFound(
    message: string,
    code: ErrorCode = ErrorCode.NOT_FOUND,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(code, message, HttpStatus.NOT_FOUND, options)
  }

  static conflict(
    message: string,
    code: ErrorCode = ErrorCode.CONFLICT,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(code, message, HttpStatus.CONFLICT, options)
  }

  static unprocessable(
    message: string,
    code: ErrorCode = ErrorCode.UNPROCESSABLE_ENTITY,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(
      code,
      message,
      HttpStatus.UNPROCESSABLE_ENTITY,
      options,
    )
  }

  static tooManyRequests(
    message: string,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(
      ErrorCode.RATE_LIMIT_EXCEEDED,
      message,
      HttpStatus.TOO_MANY_REQUESTS,
      options,
    )
  }

  static internal(
    message = 'Error interno del servidor',
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(
      ErrorCode.INTERNAL_ERROR,
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      options,
    )
  }

  /**
   * Falla al llamar a una API externa. Se devuelve como 502 para no confundir
   * al cliente sobre quién falló.
   */
  static externalService(
    serviceName: string,
    message: string,
    options?: AppExceptionOptions,
  ): AppException {
    return new AppException(
      ErrorCode.EXTERNAL_SERVICE_ERROR,
      message,
      HttpStatus.BAD_GATEWAY,
      {
        ...options,
        metadata: { ...options?.metadata, service: serviceName },
      },
    )
  }
}
