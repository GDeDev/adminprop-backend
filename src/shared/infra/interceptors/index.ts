import { ExternalApiCallLoggerInterceptor } from './external-api-call-logger.interceptor'
import { InterceptorsHandler } from './interceptors-handler'

export const Interceptors = [
  InterceptorsHandler,
  ExternalApiCallLoggerInterceptor,
]
