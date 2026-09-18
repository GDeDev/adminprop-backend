import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { tap } from 'rxjs/operators'
import { CustomLoggerService } from '../../core/logger.service'

@Injectable()
export class ExternalApiCallLoggerInterceptor implements NestInterceptor {
  private readonly logger = new CustomLoggerService('ExternalApiCallLogger')

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest()
    const { method, url } = request
    const startTime = Date.now()

    return next.handle().pipe(
      tap({
        next: (responseData) => {
          this.logger.logApiCall(
            method,
            url,
            'status' in responseData ? responseData.status : 200,
            Date.now() - startTime,
            {
              success: true,
            },
          )
        },
        error: (error) => {
          const duration = Date.now() - startTime
          this.logger.error(`${method} ${url} failed`, error.stack, {
            operation: 'external_api_call_error',
            method,
            url,
            duration,
            errorName: error.name,
            errorMessage: error.message,
          })
        },
      }),
    )
  }
}
