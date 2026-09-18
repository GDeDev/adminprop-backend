import { HttpService } from '@nestjs/axios'
import {
  CallHandler,
  ExecutionContext,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
} from '@nestjs/common'
import { AxiosError, AxiosRequestConfig, AxiosResponse } from 'axios'
import { firstValueFrom, Observable } from 'rxjs'

import { InterceptorsHandler } from './interceptors/interceptors-handler'
import { CustomLoggerService } from '../core/logger.service'
import { errorMessage, errorStack } from '../core/error-message'
import { AppException } from '../errors/app.exception'
import { ErrorCode } from '../errors/error-codes'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'

@Injectable()
export abstract class ApiService implements OnModuleInit {
  protected baseUrl: string

  @Inject(HttpService)
  protected readonly httpService: HttpService

  @Inject(InterceptorsHandler)
  protected readonly interceptorsHandler: InterceptorsHandler

  protected readonly logger: CustomLoggerService

  constructor(protected readonly apiName: string) {
    this.logger = new CustomLoggerService(apiName)
  }

  protected abstract getApiUrl(): string
  protected abstract getApiBasePath(): string
  protected abstract getRequestConfig(
    config?: AxiosRequestConfig,
  ): AxiosRequestConfig

  protected configureInterceptors(): void {
    this.interceptorsHandler.initializeForService(this.apiName)
  }

  async onModuleInit() {
    try {
      this.baseUrl = this.getApiUrl()
      this.configureInterceptors()
      this.logger.log(`Cliente "${this.apiName}" inicializado`, {
        baseUrl: this.baseUrl,
      })
    } catch (error) {
      this.logger.error(
        `No se pudo inicializar el cliente "${this.apiName}"`,
        errorStack(error),
        { errorMessage: errorMessage(error) },
      )
      throw error
    }
  }

  private getFullUrl(endpoint: string): string {
    const basePath = this.getApiBasePath()
    const separator = basePath && !basePath.startsWith('/') ? '/' : ''
    const basePathWithSep = basePath ? `${separator}${basePath}` : ''

    const endpointSeparator = endpoint.startsWith('/') ? '' : '/'
    return `${this.baseUrl}${basePathWithSep}${endpointSeparator}${endpoint}`
  }

  private createExecutionContext(
    method: string,
    url: string,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          url: this.getFullUrl(url),
        }),
      }),
    } as ExecutionContext
  }

  private async execute<T>(
    method: string,
    endpoint: string,
    request: () => Observable<AxiosResponse<T>>,
  ): Promise<T> {
    const context = this.createExecutionContext(method, endpoint)

    try {
      const baseHandler: CallHandler = {
        handle: () => request(),
      }
      const finalObservable = this.interceptorsHandler.applyInterceptors(
        this.apiName,
        context,
        baseHandler,
      )

      const response = await firstValueFrom<AxiosResponse<T>>(finalObservable)
      return response.data
    } catch (error) {
      throw this.toAppException(error, method, endpoint)
    }
  }

  /**
   * Convierte una falla de axios en una `AppException`.
   *
   * El cliente recibe un 502/504 genérico —el que falló fue un tercero, no su
   * request— y el detalle del error remoto queda en la metadata del log.
   */
  protected toAppException(
    error: unknown,
    method: string,
    endpoint: string,
  ): AppException {
    if (error instanceof AppException) return error

    const axiosError = error as AxiosError<{ message?: string }>
    const operation = `${method} ${endpoint}`

    if (axiosError?.response) {
      const { status, data } = axiosError.response

      return AppException.externalService(
        this.apiName,
        `${this.apiName} respondió ${status} para ${operation}`,
        {
          cause: error,
          metadata: {
            upstreamStatus: status,
            upstreamMessage: data?.message,
            operation,
          },
        },
      )
    }

    const isTimeout =
      axiosError?.code === 'ECONNABORTED' || axiosError?.code === 'ETIMEDOUT'

    return new AppException(
      isTimeout
        ? ErrorCode.EXTERNAL_SERVICE_TIMEOUT
        : ErrorCode.EXTERNAL_SERVICE_UNAVAILABLE,
      isTimeout
        ? `${this.apiName} no respondió a tiempo`
        : `No se pudo contactar a ${this.apiName}`,
      isTimeout ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
      {
        cause: error,
        metadata: { operation, errorCode: axiosError?.code },
      },
    )
  }

  protected async post<T>(
    endpoint: string,
    body?: Record<string, unknown> | URLSearchParams,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.execute('POST', endpoint, () =>
      this.httpService.post<T>(
        this.getFullUrl(endpoint),
        body,
        this.getRequestConfig(config),
      ),
    )
  }

  protected async get<T>(
    endpoint: string,
    params?: Record<string, any>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.execute('GET', endpoint, () =>
      this.httpService.get<T>(
        this.getFullUrl(endpoint),
        this.getRequestConfig({ ...config, params }),
      ),
    )
  }

  protected async put<T>(
    endpoint: string,
    body?: Record<string, unknown>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.execute('PUT', endpoint, () =>
      this.httpService.put<T>(
        this.getFullUrl(endpoint),
        body,
        this.getRequestConfig(config),
      ),
    )
  }

  protected async patch<T>(
    endpoint: string,
    body?: Record<string, unknown>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.execute('PATCH', endpoint, () =>
      this.httpService.patch<T>(
        this.getFullUrl(endpoint),
        body,
        this.getRequestConfig(config),
      ),
    )
  }

  protected async delete<T>(
    endpoint: string,
    params?: Record<string, string>,
    config?: AxiosRequestConfig,
  ): Promise<T> {
    return this.execute('DELETE', endpoint, () =>
      this.httpService.delete<T>(
        this.getFullUrl(endpoint),
        this.getRequestConfig({ ...config, params }),
      ),
    )
  }
}
