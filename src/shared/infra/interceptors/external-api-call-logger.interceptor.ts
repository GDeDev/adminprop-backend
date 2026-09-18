import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'

import { createLogger } from '@/shared/logging/root-logger'

/**
 * Loguea las llamadas HTTP **salientes** que hace `ApiService`.
 *
 * Las entrantes ya las cubre pino-http; esto es para el otro lado.
 */
@Injectable()
export class ExternalApiCallLoggerInterceptor implements NestInterceptor {
  private readonly logger = createLogger('ExternalApiCall')

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const { method, url } = request
    const startTime = Date.now()

    return next.handle().pipe(
      tap({
        next: (response) => {
          this.logger.info(
            {
              operation: 'external_api_call',
              method,
              url,
              statusCode:
                response && typeof response === 'object' && 'status' in response
                  ? response.status
                  : 200,
              duration: Date.now() - startTime,
            },
            `${method} ${url}`,
          )
        },
        error: (error) => {
          this.logger.error(
            {
              operation: 'external_api_call_failed',
              method,
              url,
              duration: Date.now() - startTime,
              err: error,
            },
            `${method} ${url} falló`,
          )
        },
      }),
    )
  }
}
