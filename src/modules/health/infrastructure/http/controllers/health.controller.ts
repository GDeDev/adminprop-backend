import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
  ApiProduces,
} from '@nestjs/swagger'
import { HealthCheck, HealthCheckResult } from '@nestjs/terminus'

import { CustomHealthService } from '../../services/health.service'
import { IsPublic, Role, Roles } from '@/modules/auth/public'
import { SkipAllThrottles } from '@/shared/infra/throttler/skip-all-throttles.decorator'

/**
 * Endpoints de salud.
 *
 * Las probes (`/health`, `/health/ready`, `/health/live`) son públicas: las
 * consultan Kubernetes y el balanceador, que no tienen token.
 *
 * `/health/detailed` y `/health/metrics` **no** son públicas: exponen memoria,
 * PID, versión de Node y plataforma, que es justo lo que busca alguien
 * relevando el sistema antes de atacarlo. Requieren rol ADMIN.
 *
 * Las probes no se loguean: pino-http las filtra por path.
 *
 * Topes (D-249): `/health` y `/health/live` no cuentan (no tocan la base y las
 * pega la infraestructura cada pocos segundos). `/health/ready` consulta
 * Postgres, así que sigue con los topes globales por IP; sigue siendo pública
 * porque la usan docker y el balanceador. `/health` responde sólo
 * `{ status }`: versión, entorno y uptime son relevamiento gratis.
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: CustomHealthService) {}

  @IsPublic()
  @SkipAllThrottles()
  @Get()
  @ApiOperation({
    summary: 'Basic health check',
    description:
      'Simple health check endpoint that only returns the status (no version, environment or uptime)',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
      },
    },
  })
  @ApiProduces('application/json')
  checkHealth(): { status: 'ok' } {
    return { status: 'ok' }
  }

  @IsPublic()
  @Get('ready')
  @HealthCheck()
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Kubernetes-style readiness probe. Checks if the application is ready to serve traffic',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is ready',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not ready',
  })
  @ApiProduces('application/json')
  async checkReadiness(): Promise<HealthCheckResult> {
    return this.healthService.checkDatabaseHealth()
  }

  @IsPublic()
  @SkipAllThrottles()
  @Get('live')
  @HealthCheck()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Kubernetes-style liveness probe. Checks if the application is alive and responsive',
  })
  @ApiResponse({
    status: 200,
    description: 'Application is alive',
  })
  @ApiResponse({
    status: 503,
    description: 'Application is not responsive',
  })
  @ApiProduces('application/json')
  async checkLiveness(): Promise<HealthCheckResult> {
    return this.healthService.checkBasicHealth()
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('detailed')
  @ApiOperation({
    summary: 'Detailed health status',
    description:
      'Comprehensive health status including application info, memory, database, and system metrics',
  })
  @ApiResponse({
    status: 200,
    description: 'Detailed health information',
    schema: {
      type: 'object',
      properties: {
        name: { type: 'string', example: 'adminprop-api' },
        version: { type: 'string', example: '1.0.0' },
        environment: { type: 'string', example: 'development' },
        uptime: { type: 'number', example: 12345 },
        health: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'ok' },
            info: { type: 'object' },
            error: { type: 'object' },
            details: { type: 'object' },
          },
        },
      },
    },
  })
  @ApiProduces('application/json')
  async getDetailedHealth() {
    return this.healthService.getDetailedStatus()
  }

  @Roles(Role.ADMIN)
  @ApiBearerAuth()
  @Get('metrics')
  @ApiOperation({
    summary: 'Application metrics',
    description:
      'Returns application metrics like memory usage, uptime, and system information',
  })
  @ApiResponse({
    status: 200,
    description: 'Application metrics',
    schema: {
      type: 'object',
      properties: {
        uptime: { type: 'number', example: 12345 },
        memoryUsage: {
          type: 'object',
          properties: {
            rss: { type: 'number' },
            heapTotal: { type: 'number' },
            heapUsed: { type: 'number' },
            external: { type: 'number' },
          },
        },
        cpuUsage: { type: 'object' },
        platform: { type: 'string', example: 'linux' },
        nodeVersion: { type: 'string', example: 'v18.17.0' },
      },
    },
  })
  @ApiProduces('application/json')
  async getMetrics() {
    const appInfo = await this.healthService.getApplicationInfo()
    return {
      uptime: appInfo.uptime,
      memoryUsage: appInfo.memoryUsage,
      cpuUsage: process.cpuUsage(),
      platform: appInfo.platform,
      architecture: appInfo.architecture,
      nodeVersion: appInfo.nodeVersion,
      pid: appInfo.pid,
      timestamp: appInfo.timestamp,
    }
  }
}
