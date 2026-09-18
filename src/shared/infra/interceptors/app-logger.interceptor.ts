import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap, catchError } from 'rxjs/operators'
import { Request, Response } from 'express'
import { CustomLoggerService } from '@/shared/core/logger.service'
import { Reflector } from '@nestjs/core'

import { getCorrelationId } from '../middleware/correlation-id.middleware'
import { redact } from '../logging/redact'

export const SKIP_LOGGER_KEY = 'skipLogger'
export const SkipLogger = () => SetMetadata(SKIP_LOGGER_KEY, true)

@Injectable()
export class AppLoggerInterceptor implements NestInterceptor {
  private readonly logger = new CustomLoggerService('ApiLogger')

  constructor(private reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>()
    const skipLogger = this.reflector.getAllAndOverride<boolean>(
      SKIP_LOGGER_KEY,
      [context.getHandler(), context.getClass()],
    )
    if (skipLogger) {
      return next.handle()
    }

    const response = context.switchToHttp().getResponse<Response>()

    // El ID ya lo asignó CorrelationIdMiddleware, que corre antes que los
    // guards. Acá sólo se lee.
    const correlationId = getCorrelationId(request)

    const { method, url, headers, query, body } = request
    const userAgent = headers['user-agent']
    const ip = request.ip
    const startTime = Date.now()

    this.logger.log(`📥 Incoming ${method} ${url}`, {
      correlationId,
      operation: 'incoming_request',
      method,
      url,
      userAgent,
      ip,
      // Redactado: un query param puede traer un token de reseteo, una API key
      // o un filtro con datos personales.
      queryParams: Object.keys(query).length > 0 ? redact(query) : undefined,
      hasBody: body && Object.keys(body).length > 0,
    })

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          const duration = Date.now() - startTime
          const statusCode = response.statusCode

          // Log successful response
          this.logger.logApiCall(method, url, statusCode, duration, {
            correlationId,
            responseSize: responseData
              ? JSON.stringify(responseData).length
              : 0,
            success: true,
          })
        },
      }),
      catchError((error) => {
        const duration = Date.now() - startTime
        const statusCode = response.statusCode || 500

        // Log error response
        this.logger.error(`${method} ${url} failed`, error.stack, {
          correlationId,
          operation: 'api_error',
          method,
          url,
          statusCode,
          duration,
          errorName: error.name,
          errorMessage: error.message,
          userAgent,
          ip,
        })

        throw error
      }),
    )
  }
}
