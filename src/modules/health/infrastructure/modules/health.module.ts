import { Module } from '@nestjs/common'
import { TerminusModule } from '@nestjs/terminus'

import { HealthController } from '../http/controllers/health.controller'
import { CustomHealthService } from '../services/health.service'

@Module({
  imports: [TerminusModule],
  controllers: [HealthController],
  providers: [CustomHealthService],
})
export class HealthModule {}
