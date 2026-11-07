import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { Role, Roles } from '@/modules/auth/public'
import { RegisterIndexValueCommand } from '@/modules/indices/application/commands/register-index-value.command'
import { IndexValueView } from '@/modules/indices/application/index-value.view'
import { ListIndexValuesQuery } from '@/modules/indices/application/queries/list-index-values.query'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  IndexValueDto,
  ListIndexValuesQueryDto,
  RegisterIndexValueDto,
} from '../dtos/index-value.dtos'

/**
 * Índices ICL/IPC (spec Fase 9, 3.8). Cargar es sólo admin: un valor mal
 * cargado cambia el alquiler de todos los contratos que lo usen. Consultar,
 * admin y empleado.
 */
@ApiTags('Indices')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'indices' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class IndicesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Valores cargados de un índice, del más reciente al más viejo',
  })
  @ApiResponse({ status: 200, type: [IndexValueDto] })
  async list(
    @Query() query: ListIndexValuesQueryDto,
  ): Promise<ApiSuccessDto<IndexValueView[]>> {
    const values = await this.queryBus.execute<
      ListIndexValuesQuery,
      IndexValueView[]
    >(new ListIndexValuesQuery(query.type))
    return { success: true, message: null, data: values }
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cargar a mano el valor de un mes (sólo admin)',
    description:
      'Hasta que la Fase 13 los traiga de la fuente oficial. Un mes ya cargado no se pisa: 409.',
  })
  @ApiResponse({ status: 201, type: IndexValueDto })
  @ApiResponse({
    status: 400,
    description: 'Período o valor inválido',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ese mes ya está cargado',
    type: ApiErrorDto,
  })
  async register(
    @Body() dto: RegisterIndexValueDto,
  ): Promise<ApiSuccessDto<IndexValueView>> {
    const value = await this.commandBus.execute<
      RegisterIndexValueCommand,
      IndexValueView
    >(new RegisterIndexValueCommand(dto.indexType, dto.period, dto.value))
    return { success: true, message: 'Índice cargado', data: value }
  }
}
