import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import { Request, Response } from 'express'
import { PinoLogger } from 'nestjs-pino'

import { ApiErrorDto } from '../../dtos/api-response.dto'
import { Configuration } from '../../config/configuration'
import { AppException } from '../../errors/app.exception'
import { ErrorCode, ErrorDetail } from '../../errors/error-codes'
import { getCorrelationId } from '../../context/request-context.middleware'
import { redact } from '../logging/redact'

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ErrorCode.BAD_REQUEST,
  [HttpStatus.UNAUTHORIZED]: ErrorCode.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ErrorCode.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ErrorCode.NOT_FOUND,
  [HttpStatus.METHOD_NOT_ALLOWED]: ErrorCode.METHOD_NOT_ALLOWED,
  [HttpStatus.REQUEST_TIMEOUT]: ErrorCode.REQUEST_TIMEOUT,
  [HttpStatus.CONFLICT]: ErrorCode.CONFLICT,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ErrorCode.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ErrorCode.UNPROCESSABLE_ENTITY,
  [HttpStatus.TOO_MANY_REQUESTS]: ErrorCode.RATE_LIMIT_EXCEEDED,
  [HttpStatus.INTERNAL_SERVER_ERROR]: ErrorCode.INTERNAL_ERROR,
  [HttpStatus.BAD_GATEWAY]: ErrorCode.EXTERNAL_SERVICE_ERROR,
  [HttpStatus.SERVICE_UNAVAILABLE]: ErrorCode.SERVICE_UNAVAILABLE,
  [HttpStatus.GATEWAY_TIMEOUT]: ErrorCode.EXTERNAL_SERVICE_TIMEOUT,
}

/** Lo único que ve el cliente ante un 5xx en producción. */
const GENERIC_500_MESSAGE =
  'Ocurrió un error interno. Si el problema persiste, pasá el correlationId al soporte.'

interface NormalizedError {
  status: number
  code: ErrorCode | string
  message: string
  details: ErrorDetail[]
  /** Metadata para los logs. Nunca se serializa al cliente. */
  metadata?: Record<string, unknown>
}

/**
 * Filtro catch-all. Es el último eslabón: cualquier excepción que no capture un
 * filtro más específico termina acá y sale con el formato de `ApiErrorDto`.
 *
 * Reglas:
 *  - Un 5xx nunca filtra el mensaje interno en producción (sí va completo al log).
 *  - Los 4xx sí devuelven su mensaje: son problemas del cliente y necesita saber cuál.
 *  - Todo se loguea con el `correlationId` para poder cruzarlo con el request.
 */
@Injectable()
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly isProduction: boolean

  constructor(
    private readonly logger: PinoLogger,
    configService: ConfigService<Configuration, true>,
  ) {
    this.logger.setContext('ExceptionFilter')
    this.isProduction = configService.get('app', { infer: true }).isProduction
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()
    const correlationId = getCorrelationId(request)

    const normalized = this.normalize(exception)
    this.log(normalized, exception, request, correlationId)

    // Si la respuesta ya empezó a enviarse (streaming, por ejemplo) no podemos
    // reescribir el status: cortamos la conexión y listo.
    if (response.headersSent) {
      response.end()
      return
    }

    const isServerError = normalized.status >= 500
    const body: ApiErrorDto = {
      success: false,
      code: normalized.code,
      message:
        isServerError && this.isProduction
          ? GENERIC_500_MESSAGE
          : normalized.message,
      errors: isServerError && this.isProduction ? [] : normalized.details,
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.originalUrl ?? request.url,
    }

    response.status(normalized.status).json(body)
  }

  // --------------------------------------------------------------- normalización

  private normalize(exception: unknown): NormalizedError {
    if (exception instanceof AppException) {
      return {
        status: exception.getStatus(),
        code: exception.code,
        message: exception.message,
        details: exception.details,
        metadata: exception.metadata,
      }
    }

    if (exception instanceof HttpException) {
      return this.fromHttpException(exception)
    }

    // Body demasiado grande / JSON malformado: los tira body-parser antes de
    // llegar a cualquier handler, y no son HttpException.
    const bodyParserError = this.fromBodyParserError(exception)
    if (bodyParserError) return bodyParserError

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.INTERNAL_ERROR,
      message:
        exception instanceof Error
          ? exception.message
          : 'Error interno del servidor',
      details: [],
    }
  }

  private fromHttpException(exception: HttpException): NormalizedError {
    const status = exception.getStatus()
    const payload = exception.getResponse()
    const fallbackCode = STATUS_TO_CODE[status] ?? ErrorCode.INTERNAL_ERROR

    if (typeof payload === 'string') {
      return { status, code: fallbackCode, message: payload, details: [] }
    }

    const record = (payload ?? {}) as Record<string, unknown>

    // `CustomValidationPipe` y los factories de `AppException` ya emiten
    // `{ code, message, errors }`; las excepciones nativas de Nest, `{ message }`.
    const details = Array.isArray(record.errors)
      ? (record.errors as ErrorDetail[])
      : []

    const rawMessage = record.message ?? exception.message
    const message = Array.isArray(rawMessage)
      ? rawMessage.join('; ')
      : String(rawMessage)

    return {
      status,
      code: (record.code as string) ?? fallbackCode,
      message,
      details,
    }
  }

  private fromBodyParserError(exception: unknown): NormalizedError | null {
    if (typeof exception !== 'object' || exception === null) return null

    const error = exception as { type?: string; status?: number }

    if (error.type === 'entity.too.large') {
      return {
        status: HttpStatus.PAYLOAD_TOO_LARGE,
        code: ErrorCode.PAYLOAD_TOO_LARGE,
        message: 'El cuerpo del request supera el tamaño máximo permitido',
        details: [],
      }
    }

    if (error.type === 'entity.parse.failed') {
      return {
        status: HttpStatus.BAD_REQUEST,
        code: ErrorCode.BAD_REQUEST,
        message: 'El cuerpo del request no es un JSON válido',
        details: [],
      }
    }

    if (
      error.type === 'charset.unsupported' ||
      error.type === 'encoding.unsupported'
    ) {
      return {
        status: HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        code: ErrorCode.UNSUPPORTED_MEDIA_TYPE,
        message: 'Charset o encoding no soportado',
        details: [],
      }
    }

    return null
  }

  // ---------------------------------------------------------------------- logging

  private log(
    normalized: NormalizedError,
    exception: unknown,
    request: Request,
    correlationId: string,
  ): void {
    const context = {
      correlationId,
      operation: 'request_failed',
      method: request.method,
      url: request.originalUrl ?? request.url,
      statusCode: normalized.status,
      errorCode: normalized.code,
      ip: request.ip,
      ...(normalized.metadata ?? {}),
    }

    const summary = `${request.method} ${context.url} → ${normalized.status} ${normalized.code}: ${normalized.message}`

    if (normalized.status >= 500) {
      // Un 5xx es un bug nuestro: va con stack y con el request completo
      // (redactado) para poder reproducirlo.
      this.logger.error(
        {
          ...context,
          err: exception,
          query: redact(request.query),
          body: redact(request.body),
        },
        summary,
      )
      return
    }

    // Los 4xx son ruido esperable: warn sin stack ni payload.
    this.logger.warn(context, summary)
  }
}
