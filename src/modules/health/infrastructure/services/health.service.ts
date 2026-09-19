import { Injectable } from '@nestjs/common'
import {
  HealthCheckService,
  MemoryHealthIndicator,
  HealthCheck,
  HealthCheckResult,
} from '@nestjs/terminus'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { errorMessage } from '@/shared/core/error-message'

export interface DatabaseHealthIndicator {
  isHealthy(key: string): Promise<{ [key: string]: any }>
}

@Injectable()
export class CustomHealthService {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  @HealthCheck()
  async checkBasicHealth(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
    ])
  }

  @HealthCheck()
  async checkDatabaseHealth(): Promise<HealthCheckResult> {
    return this.health.check([
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`
          return {
            database: {
              status: 'up',
              message: 'Database connection is healthy',
            },
          }
        } catch (error) {
          return {
            database: {
              status: 'down',
              message: `Database connection failed: ${errorMessage(error)}`,
            },
          }
        }
      },
    ])
  }

  @HealthCheck()
  async checkFullHealth(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),
      () => this.memory.checkRSS('memory_rss', 150 * 1024 * 1024),
      async () => {
        try {
          await this.prisma.$queryRaw`SELECT 1`
          return {
            database: {
              status: 'up',
              message: 'Database connection is healthy',
              responseTime: Date.now(),
            },
          }
        } catch (error) {
          return {
            database: {
              status: 'down',
              message: `Database connection failed: ${errorMessage(error)}`,
            },
          }
        }
      },
    ])
  }

  async getApplicationInfo() {
    return {
      name: process.env.APP_NAME || process.env.npm_package_name || 'api',
      version: process.env.npm_package_version || '1.0.0',
      description: process.env.npm_package_description || 'NestJS API Template',
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      pid: process.pid,
      platform: process.platform,
      architecture: process.arch,
      memoryUsage: process.memoryUsage(),
    }
  }

  async getDetailedStatus() {
    const appInfo = await this.getApplicationInfo()
    const healthCheck = await this.checkFullHealth()

    return {
      ...appInfo,
      health: healthCheck,
      endpoints: {
        health: '/health',
        ready: '/health/ready',
        live: '/health/live',
        metrics: '/health/metrics',
      },
    }
  }
}
