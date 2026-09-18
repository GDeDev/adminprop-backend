import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'

import { ExternalApiCallLoggerInterceptor } from './external-api-call-logger.interceptor'

/**
 * Nombres de los interceptores disponibles para las llamadas salientes.
 * Registrá los propios con `registerInterceptor()` desde el `ApiService`.
 */
export type InterceptorName = 'api-logger' | (string & {})

interface InterceptorEntry {
  name: InterceptorName
  interceptor: NestInterceptor
  enabled: boolean
}

interface ServiceInterceptorsConfig {
  interceptors: InterceptorEntry[]
}

/**
 * Pipeline de interceptores para las llamadas HTTP *salientes* (las que hace
 * `ApiService`). No tiene nada que ver con los interceptores de NestJS para
 * requests entrantes.
 *
 * Cada servicio externo tiene su propia configuración, así podés apagar un
 * interceptor puntual para una API sin afectar al resto.
 */
@Injectable()
export class InterceptorsHandler {
  private serviceConfigurations = new Map<string, ServiceInterceptorsConfig>()

  constructor(
    private readonly apiLoggerInterceptor: ExternalApiCallLoggerInterceptor,
  ) {}

  initializeForService(serviceName: string): void {
    if (this.serviceConfigurations.has(serviceName)) return

    this.serviceConfigurations.set(serviceName, {
      interceptors: [
        {
          name: 'api-logger',
          interceptor: this.apiLoggerInterceptor,
          enabled: true,
        },
      ],
    })
  }

  /**
   * Suma un interceptor propio al pipeline de un servicio. Los interceptores se
   * aplican en orden de registro: el último queda más cerca de la request.
   */
  registerInterceptor(
    serviceName: string,
    name: InterceptorName,
    interceptor: NestInterceptor,
    enabled = true,
  ): void {
    const config = this.getServiceConfig(serviceName)
    const existing = config.interceptors.findIndex((i) => i.name === name)

    if (existing >= 0) {
      config.interceptors[existing] = { name, interceptor, enabled }
      return
    }

    config.interceptors.push({ name, interceptor, enabled })
  }

  private getServiceConfig(serviceName: string): ServiceInterceptorsConfig {
    const existing = this.serviceConfigurations.get(serviceName)
    if (existing) return existing

    this.initializeForService(serviceName)
    // `initializeForService` acaba de crearla, así que siempre está.
    return this.serviceConfigurations.get(serviceName)!
  }

  private setEnabled(
    serviceName: string,
    interceptorName: InterceptorName,
    enabled: boolean,
  ): void {
    const config = this.getServiceConfig(serviceName)
    config.interceptors = config.interceptors.map((i) =>
      i.name === interceptorName ? { ...i, enabled } : i,
    )
  }

  enableInterceptor(
    serviceName: string,
    interceptorName: InterceptorName,
  ): void {
    this.setEnabled(serviceName, interceptorName, true)
  }

  disableInterceptor(
    serviceName: string,
    interceptorName: InterceptorName,
  ): void {
    this.setEnabled(serviceName, interceptorName, false)
  }

  applyInterceptors(
    serviceName: string,
    context: ExecutionContext,
    baseHandler: CallHandler,
  ): Observable<any> {
    const config = this.getServiceConfig(serviceName)
    let handler = baseHandler

    for (const entry of config.interceptors.filter((e) => e.enabled)) {
      const currentHandler = handler
      handler = {
        handle: () =>
          entry.interceptor.intercept(
            context,
            currentHandler,
          ) as Observable<any>,
      }
    }

    return handler.handle()
  }
}
