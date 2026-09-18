import { Injectable, LoggerService, Scope } from '@nestjs/common'

export interface LogContext {
  correlationId?: string
  userId?: string
  operation?: string
  duration?: number
  statusCode?: number
  method?: string
  url?: string
  userAgent?: string
  ip?: string
  [key: string]: any
}

export interface StructuredLog {
  timestamp: string
  level: string
  message: string
  context?: string
  correlationId?: string
  metadata?: Record<string, any>
  error?: {
    name: string
    message: string
    stack?: string
  }
}

@Injectable({ scope: Scope.TRANSIENT })
export class CustomLoggerService implements LoggerService {
  private context?: string
  private static logLevel: string = process.env.LOG_LEVEL || 'info'

  constructor(context?: string) {
    this.context = context
  }

  setContext(context: string) {
    this.context = context
  }

  /**
   * Niveles, de menos a más verboso. Un mensaje se emite si su nivel es menor o
   * igual al configurado en `LOG_LEVEL`.
   */
  private static readonly LOG_LEVELS = {
    error: 0,
    warn: 1,
    info: 2,
    debug: 3,
    verbose: 4,
  } as const

  private static readonly DEFAULT_LEVEL = 2

  /** Resuelve un nivel arbitrario; `LOG_LEVEL` viene del entorno sin validar. */
  private static levelValue(level: string): number {
    const levels: Record<string, number> = CustomLoggerService.LOG_LEVELS
    return levels[level] ?? CustomLoggerService.DEFAULT_LEVEL
  }

  private shouldLog(level: string): boolean {
    return (
      CustomLoggerService.levelValue(level) <=
      CustomLoggerService.levelValue(CustomLoggerService.logLevel)
    )
  }

  private formatLog(
    level: string,
    message: string,
    context?: LogContext,
  ): StructuredLog {
    const log: StructuredLog = {
      timestamp: new Date().toISOString(),
      level: level.toUpperCase(),
      message,
      context: this.context,
      correlationId: context?.correlationId,
    }

    // Add metadata if present
    if (context) {
      const { correlationId: _correlationId, ...metadata } = context
      if (Object.keys(metadata).length > 0) {
        log.metadata = metadata
      }
    }

    return log
  }

  private outputLog(log: StructuredLog): void {
    if (process.env.NODE_ENV === 'production') {
      // Production: JSON structured logging
      console.log(JSON.stringify(log))
    } else {
      // Development: Human readable format
      const prefix = `[${log.timestamp}] [${log.level}]`
      const contextStr = log.context ? ` [${log.context}]` : ''
      const correlationStr = log.correlationId ? ` [${log.correlationId}]` : ''

      let output = `${prefix}${contextStr}${correlationStr} ${log.message}`

      if (log.metadata && Object.keys(log.metadata).length > 0) {
        output += `\n  📋 Metadata: ${JSON.stringify(log.metadata, null, 2)}`
      }

      // Color coding for development
      switch (log.level) {
        case 'ERROR':
          console.error(`🔴 ${output}`)
          break
        case 'WARN':
          console.warn(`🟡 ${output}`)
          break
        case 'INFO':
          console.info(`🔵 ${output}`)
          break
        case 'DEBUG':
          console.debug(`🟣 ${output}`)
          break
        default:
          console.log(`⚪ ${output}`)
      }
    }
  }

  error(message: string, trace?: string, context?: LogContext): void {
    if (!this.shouldLog('error')) return

    const log = this.formatLog('error', message, context)

    if (trace) {
      log.error = {
        name: 'Error',
        message,
        stack: trace,
      }
    }

    this.outputLog(log)
  }

  warn(message: string, context?: LogContext): void {
    if (!this.shouldLog('warn')) return
    this.outputLog(this.formatLog('warn', message, context))
  }

  log(message: string, context?: LogContext): void {
    if (!this.shouldLog('info')) return
    this.outputLog(this.formatLog('info', message, context))
  }

  debug(message: string, context?: LogContext): void {
    if (!this.shouldLog('debug')) return
    this.outputLog(this.formatLog('debug', message, context))
  }

  verbose(message: string, context?: LogContext): void {
    if (!this.shouldLog('verbose')) return
    this.outputLog(this.formatLog('verbose', message, context))
  }

  // Convenience methods for common use cases
  logApiCall(
    method: string,
    url: string,
    statusCode: number,
    duration: number,
    context?: LogContext,
  ): void {
    this.log(`${method} ${url} - ${statusCode} - ${duration}ms`, {
      ...context,
      operation: 'api_call',
      method,
      url,
      statusCode,
      duration,
    })
  }

  logCommandExecution(
    commandName: string,
    duration: number,
    success: boolean,
    context?: LogContext,
  ): void {
    const message = `Command ${commandName} ${success ? 'completed' : 'failed'} in ${duration}ms`
    const level = success ? 'info' : 'error'

    const logContext = {
      ...context,
      operation: 'command_execution',
      commandName,
      duration,
      success,
    }

    if (level === 'info') {
      this.log(message, logContext)
    } else {
      this.error(message, undefined, logContext)
    }
  }

  logQueryExecution(
    queryName: string,
    duration: number,
    resultCount?: number,
    context?: LogContext,
  ): void {
    this.log(`Query ${queryName} executed in ${duration}ms`, {
      ...context,
      operation: 'query_execution',
      queryName,
      duration,
      resultCount,
    })
  }

  logBusinessOperation(
    operation: string,
    entityId?: string,
    userId?: string,
    context?: LogContext,
  ): void {
    this.log(`Business operation: ${operation}`, {
      ...context,
      operation: 'business_operation',
      businessOperation: operation,
      entityId,
      userId,
    })
  }
}
