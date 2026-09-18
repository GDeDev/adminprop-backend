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
import { IsPublic } from '@/infrastructure/auth/decorators/is-public.decorator'
import { Roles } from '@/infrastructure/auth/decorators/roles.decorator'
import { Role } from '@/domain/auth/enums/role.enum'
import { SkipLogger } from '@/shared/infra/interceptors/app-logger.interceptor'

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
 * Todo el controller está marcado con `@SkipLogger()` para que las probes no
 * inunden los logs.
 */
@ApiTags('Health')
@SkipLogger()
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly healthService: CustomHealthService) {}

  @IsPublic()
  @Get()
  @ApiOperation({
    summary: 'Basic health check',
    description:
      'Simple health check endpoint that returns basic application status',
  })
  @ApiResponse({
    status: 200,
    description: 'Health check successful',
    schema: {
      type: 'object',
      properties: {
        status: { type: 'string', example: 'ok' },
        timestamp: { type: 'string', example: '2023-12-01T10:00:00Z' },
        uptime: { type: 'number', example: 12345 },
        version: { type: 'string', example: '1.0.0' },
        environment: { type: 'string', example: 'development' },
      },
    },
  })
  @ApiProduces('application/json')
  async checkHealth() {
    const appInfo = await this.healthService.getApplicationInfo()
    return {
      status: 'ok',
      timestamp: appInfo.timestamp,
      uptime: appInfo.uptime,
      version: appInfo.version,
      environment: appInfo.environment,
    }
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
