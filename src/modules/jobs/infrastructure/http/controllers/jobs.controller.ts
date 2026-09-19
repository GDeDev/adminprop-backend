import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { AsyncJobStatusView } from '@/modules/jobs/application/queries/get-async-job-status/get-async-job-status.handler'
import { GetAsyncJobStatusQuery } from '@/modules/jobs/application/queries/get-async-job-status/get-async-job-status.query'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { AsyncJobStatusDto } from '../dtos/async-job-status.dto'

/**
 * Endpoint único para consultar cualquier trabajo en background, sea del
 * módulo que sea (spec Fase 1, 9.1). No se crea uno por módulo.
 */
@ApiTags('Jobs')
@ApiBearerAuth()
@Controller({ path: 'jobs' })
export class JobsController {
  constructor(private readonly queryBus: QueryBus) {}

  // Sólo el backoffice: propietarios e inquilinos comparten tenant con la
  // inmobiliaria, y el resultado de un trabajo puede tener datos de otros.
  @Roles(Role.ADMIN, Role.EMPLOYEE)
  @Get(':id/status')
  @ApiOperation({
    summary: 'Estado de un trabajo en background',
    description:
      'Para consultar el avance de una acción que respondió 202 con un jobId.',
  })
  @ApiResponse({ status: 200, type: AsyncJobStatusDto })
  @ApiResponse({
    status: 404,
    description: 'No existe, o es de otra inmobiliaria',
    type: ApiErrorDto,
  })
  async status(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<AsyncJobStatusView>> {
    const job = await this.queryBus.execute<
      GetAsyncJobStatusQuery,
      AsyncJobStatusView
    >(new GetAsyncJobStatusQuery(id))

    return { success: true, message: null, data: job }
  }
}
