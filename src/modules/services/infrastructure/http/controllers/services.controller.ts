import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
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
import {
  CreateServiceCommand,
  DeleteServiceCommand,
  ServiceData,
  UpdateServiceCommand,
} from '@/modules/services/application/commands/service.commands'
import {
  ListContractServicesQuery,
  ListOverdueServicesQuery,
  ListPropertyServicesQuery,
} from '@/modules/services/application/queries/service.queries'
import {
  ContractServiceView,
  OverdueServiceView,
  PropertyServiceView,
} from '@/modules/services/application/service.views'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ContractServiceDto,
  CreateServiceDto,
  ListOverdueServicesQueryDto,
  ListPropertyServicesQueryDto,
  OverdueServiceDto,
  PropertyServiceDto,
  UpdateServiceDto,
} from '../dtos/service.dtos'

function toServiceData(dto: CreateServiceDto): ServiceData {
  return {
    contractId: dto.contractId ?? null,
    serviceTypeId: dto.serviceTypeId,
    paidBy: dto.paidBy,
    currency: dto.currency,
    hasDueDate: dto.hasDueDate,
    dueDate: dto.dueDate ?? null,
    hasIncrease: dto.hasIncrease,
    increaseFrequency: dto.increaseFrequency ?? null,
    managedByAgency: dto.managedByAgency,
    notes: dto.notes ?? null,
  }
}

/** Sólo lo que vino: la mezcla con lo actual la hace el handler. */
function toServiceChanges(dto: UpdateServiceDto): Partial<ServiceData> {
  const changes: Partial<ServiceData> = {}
  if (dto.contractId !== undefined) changes.contractId = dto.contractId
  if (dto.serviceTypeId !== undefined) changes.serviceTypeId = dto.serviceTypeId
  if (dto.paidBy !== undefined) changes.paidBy = dto.paidBy
  if (dto.currency !== undefined) changes.currency = dto.currency
  if (dto.hasDueDate !== undefined) changes.hasDueDate = dto.hasDueDate
  if (dto.dueDate !== undefined) changes.dueDate = dto.dueDate
  if (dto.hasIncrease !== undefined) changes.hasIncrease = dto.hasIncrease
  if (dto.increaseFrequency !== undefined) {
    changes.increaseFrequency = dto.increaseFrequency
  }
  if (dto.managedByAgency !== undefined) {
    changes.managedByAgency = dto.managedByAgency
  }
  if (dto.notes !== undefined) changes.notes = dto.notes
  return changes
}

/**
 * Servicios de propiedades y contratos (spec Fase 10, 3.1). Admin y empleado
 * operan todo. Las rutas cuelgan de propiedades, contratos y `/services`,
 * pero el módulo es uno solo: por eso el controller no tiene prefijo.
 */
@ApiTags('Services')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller()
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class ServicesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('properties/:propertyId/services')
  @ApiOperation({
    summary: 'Servicios de una propiedad',
    description:
      'Todos los de la propiedad (de la propiedad y de sus contratos), cada uno con su estado calculado. `contractId` deja sólo los de ese contrato.',
  })
  @ApiResponse({ status: 200, type: [PropertyServiceDto] })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async listByProperty(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Query() query: ListPropertyServicesQueryDto,
  ): Promise<ApiSuccessDto<PropertyServiceView[]>> {
    const services = await this.queryBus.execute<
      ListPropertyServicesQuery,
      PropertyServiceView[]
    >(new ListPropertyServicesQuery(propertyId, query.contractId))
    return { success: true, message: null, data: services }
  }

  @Post('properties/:propertyId/services')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Alta de un servicio en una propiedad',
    description:
      'Sin `contractId` es un servicio de la propiedad, que sus contratos heredan. Con vencimiento exige `dueDate`; con aumentos, `increaseFrequency`.',
  })
  @ApiResponse({ status: 201, type: PropertyServiceDto })
  @ApiResponse({
    status: 400,
    description: 'Falta la fecha de vencimiento o la frecuencia de aumento',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description:
      'Propiedad inexistente, contrato de otra propiedad, o tipo de servicio inexistente o desactivado',
    type: ApiErrorDto,
  })
  async create(
    @Param('propertyId', new ParseUUIDPipe()) propertyId: string,
    @Body() dto: CreateServiceDto,
  ): Promise<ApiSuccessDto<PropertyServiceView>> {
    const service = await this.commandBus.execute<
      CreateServiceCommand,
      PropertyServiceView
    >(new CreateServiceCommand(propertyId, toServiceData(dto)))
    return { success: true, message: 'Servicio creado', data: service }
  }

  @Get('contracts/:contractId/services')
  @ApiOperation({
    summary: 'Servicios que aplican a un contrato',
    description:
      'Los cargados para el contrato (`scope: CONTRACT`) más los de la propiedad sin contrato, que hereda (`scope: PROPERTY`).',
  })
  @ApiResponse({ status: 200, type: [ContractServiceDto] })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async listByContract(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ): Promise<ApiSuccessDto<ContractServiceView[]>> {
    const services = await this.queryBus.execute<
      ListContractServicesQuery,
      ContractServiceView[]
    >(new ListContractServicesQuery(contractId))
    return { success: true, message: null, data: services }
  }

  @Get('services/overdue')
  @ApiOperation({
    summary: 'Servicios vencidos de la inmobiliaria (dashboard)',
    description:
      'Los que tienen vencimiento y la fecha ya pasó, los más atrasados primero, con la propiedad. Filtrable por propiedad.',
  })
  @ApiPaginatedResponse(OverdueServiceDto, 'Servicios vencidos')
  async listOverdue(
    @Query() query: ListOverdueServicesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<OverdueServiceView>>> {
    const result = await this.queryBus.execute<
      ListOverdueServicesQuery,
      PaginatedResult<OverdueServiceView>
    >(
      new ListOverdueServicesQuery(
        { propertyId: query.propertyId },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Patch('services/:id')
  @ApiOperation({
    summary: 'Editar un servicio',
    description:
      'Todo menos la propiedad. Vencimiento y aumentos se validan sobre el servicio resultante.',
  })
  @ApiResponse({ status: 200, type: PropertyServiceDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateServiceDto,
  ): Promise<ApiSuccessDto<PropertyServiceView>> {
    const service = await this.commandBus.execute<
      UpdateServiceCommand,
      PropertyServiceView
    >(new UpdateServiceCommand(id, toServiceChanges(dto)))
    return { success: true, message: 'Servicio actualizado', data: service }
  }

  @Delete('services/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Eliminar un servicio (borrado lógico)' })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeleteServiceCommand, void>(
      new DeleteServiceCommand(id),
    )
  }
}
