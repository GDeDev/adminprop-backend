import { QueryHandler, IQueryHandler } from '@nestjs/cqrs'

import { ExampleRepository } from '@/infrastructure/example/repositories/example.repository'
import { GetExamplesQuery } from './get-examples.query'
import { PaginationService } from '@/shared/services/pagination.service'
import { ResponseWithPagination } from '@/shared/dtos/pagination.dto'
import { Example } from '@/domain/feature/entities/example.entity'
import { CustomLoggerService } from '@/shared/core/logger.service'

export type GetExamplesResponse = ResponseWithPagination<Example[]>

@QueryHandler(GetExamplesQuery)
export class GetExamplesHandler implements IQueryHandler<
  GetExamplesQuery,
  GetExamplesResponse
> {
  private readonly logger = new CustomLoggerService(GetExamplesHandler.name)

  constructor(
    private readonly exampleRepository: ExampleRepository,
    private readonly paginationService: PaginationService,
  ) {}

  async execute(_query: GetExamplesQuery): Promise<GetExamplesResponse> {
    const startTime = Date.now()

    this.logger.log('Starting GetExamplesQuery execution', {
      operation: 'query_start',
      queryName: 'GetExamplesQuery',
    })

    try {
      const examples = await this.exampleRepository.findAll()
      const duration = Date.now() - startTime

      const pagination = this.paginationService.createPaginationMetadata(
        1,
        examples.length,
        examples.length,
      )

      this.logger.logQueryExecution(
        'GetExamplesQuery',
        duration,
        examples.length,
        {
          resultCount: examples.length,
          paginationTotal: examples.length,
        },
      )

      return {
        data: examples,
        pagination,
      }
    } catch (error) {
      const duration = Date.now() - startTime

      this.logger.error('GetExamplesQuery execution failed', error.stack, {
        operation: 'query_error',
        queryName: 'GetExamplesQuery',
        duration,
        errorName: error.name,
        errorMessage: error.message,
      })

      throw error
    }
  }
}
