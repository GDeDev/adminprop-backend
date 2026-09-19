import { Module } from '@nestjs/common'

import { GetAsyncJobStatusHandler } from '@/modules/jobs/application/queries/get-async-job-status/get-async-job-status.handler'
import { AsyncJobRepository } from '@/modules/jobs/domain/async-job.repository'
import { AsyncJobsFacade } from '@/modules/jobs/public/async-jobs.facade'
import { JobsController } from '../http/controllers/jobs.controller'
import { AsyncJobRepositoryImpl } from '../repositories/async-job.repository.impl'

/**
 * Trabajos en background. Otros módulos lo importan (desde `public/`) para
 * inyectar `AsyncJobsFacade`; el repositorio queda interno.
 */
@Module({
  controllers: [JobsController],
  providers: [
    { provide: AsyncJobRepository, useClass: AsyncJobRepositoryImpl },
    GetAsyncJobStatusHandler,
    AsyncJobsFacade,
  ],
  exports: [AsyncJobsFacade],
})
export class JobsModule {}
