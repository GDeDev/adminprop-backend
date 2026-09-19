import { IQueryHandler, QueryHandler } from '@nestjs/cqrs'

import {
  AsyncJobStatus,
  progressPercentage,
} from '@/modules/jobs/domain/async-job.entity'
import { AsyncJobNotFoundException } from '@/modules/jobs/domain/async-job.exceptions'
import { AsyncJobRepository } from '@/modules/jobs/domain/async-job.repository'
import { GetAsyncJobStatusQuery } from './get-async-job-status.query'

export interface AsyncJobStatusView {
  id: string
  type: string
  status: AsyncJobStatus
  totalItems: number | null
  processedItems: number
  failedItems: number
  /** 0 a 100, o null si no se conoce el total. */
  progress: number | null
  result: unknown
  startedAt: Date
  finishedAt: Date | null
}

@QueryHandler(GetAsyncJobStatusQuery)
export class GetAsyncJobStatusHandler implements IQueryHandler<
  GetAsyncJobStatusQuery,
  AsyncJobStatusView
> {
  constructor(private readonly jobs: AsyncJobRepository) {}

  async execute(query: GetAsyncJobStatusQuery): Promise<AsyncJobStatusView> {
    const job = await this.jobs.findById(query.jobId)
    if (!job) throw new AsyncJobNotFoundException(query.jobId)

    return {
      id: job.id,
      type: job.type,
      status: job.status,
      totalItems: job.totalItems,
      processedItems: job.processedItems,
      failedItems: job.failedItems,
      progress: progressPercentage(job),
      result: job.result,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    }
  }
}
