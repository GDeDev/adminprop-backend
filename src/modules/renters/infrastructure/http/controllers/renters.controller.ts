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

import {
  PortalCredentials,
  PortalCredentialsDto,
  Role,
  Roles,
} from '@/modules/auth/public'
import {
  CreateRenterCommand,
  DeleteRenterCommand,
  IssueRenterPortalCredentialsCommand,
  UpdateRenterCommand,
} from '@/modules/renters/application/commands/renter.commands'
import {
  CheckRenterDataQuery,
  GetRenterQuery,
  ListRentersQuery,
  RenterDataCheck,
} from '@/modules/renters/application/queries/renter.queries'
import {
  RenterDetailView,
  RenterSummaryView,
} from '@/modules/renters/application/renter.views'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  CheckRenterDataQueryDto,
  CreateRenterDto,
  ListRentersQueryDto,
  RenterDataCheckDto,
  RenterDetailDto,
  RenterSummaryDto,
  UpdateRenterDto,
} from '../dtos/renter.dtos'

/**
 * Inquilinos (spec Fase 8). Admin y empleado operan; borrar es sólo admin.
 * La ruta es `renters` y no `tenants`: "tenant" es la inmobiliaria.
 */
@ApiTags('Renters')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'renters' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class RentersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar, con búsqueda por nombre o DNI',
    description:
      'Cada inquilino trae a su garante. Los filtros `paymentStatus` (Fase 11) y ' +
      '`propertyId` (Fase 9) se aceptan y validan desde ya, pero todavía no filtran: ' +
      'no hay cuotas ni contratos contra qué cruzar.',
  })
  @ApiPaginatedResponse(RenterSummaryDto, 'Inquilinos de la inmobiliaria')
  async list(
    @Query() query: ListRentersQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<RenterSummaryView>>> {
    const result = await this.queryBus.execute<
      ListRentersQuery,
      PaginatedResult<RenterSummaryView>
    >(
      new ListRentersQuery(
        {
          search: query.search || undefined,
          paymentStatus: query.paymentStatus,
          propertyId: query.propertyId,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  // Antes de `:id`, para que "check" no se lea como un id.
  @Get('check')
  @ApiOperation({
    summary: 'Chequear el DNI mientras se completa el formulario',
    description: 'El DNI repetido bloquea el alta.',
  })
  @ApiResponse({ status: 200, type: RenterDataCheckDto })
  async check(
    @Query() query: CheckRenterDataQueryDto,
  ): Promise<ApiSuccessDto<RenterDataCheck>> {
    const result = await this.queryBus.execute<
      CheckRenterDataQuery,
      RenterDataCheck
    >(new CheckRenterDataQuery(query.nationalId, query.excludeId))
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ficha completa, con el garante expandido',
    description:
      '`activeContract` (Fase 9) y `payments` (Fase 11) vienen vacíos hasta esas fases.',
  })
  @ApiResponse({ status: 200, type: RenterDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<RenterDetailView>> {
    const renter = await this.queryBus.execute<
      GetRenterQuery,
      RenterDetailView
    >(new GetRenterQuery(id))
    return { success: true, message: null, data: renter }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Alta' })
  @ApiResponse({ status: 201, type: RenterDetailDto })
  @ApiResponse({
    status: 400,
    description: 'DNI o fecha de ingreso inválidos',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ya hay un inquilino con ese DNI',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El garante no existe en la inmobiliaria',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateRenterDto,
  ): Promise<ApiSuccessDto<RenterDetailView>> {
    const renter = await this.commandBus.execute<
      CreateRenterCommand,
      RenterDetailView
    >(
      new CreateRenterCommand({
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        moveInDate: dto.moveInDate ?? null,
        notes: dto.notes ?? null,
        guarantorId: dto.guarantorId ?? null,
      }),
    )
    return { success: true, message: 'Inquilino creado', data: renter }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar',
    description:
      'Incluye el cambio de garante (`guarantorId`, o null para sacarlo); queda en la auditoría.',
  })
  @ApiResponse({ status: 200, type: RenterDetailDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateRenterDto,
  ): Promise<ApiSuccessDto<RenterDetailView>> {
    const renter = await this.commandBus.execute<
      UpdateRenterCommand,
      RenterDetailView
    >(
      new UpdateRenterCommand(id, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        moveInDate: dto.moveInDate,
        notes: dto.notes,
        guarantorId: dto.guarantorId,
      }),
    )
    return { success: true, message: 'Inquilino actualizado', data: renter }
  }

  @Post(':id/portal-credentials')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Generar (o regenerar) el acceso al portal',
    description:
      'Devuelve la contraseña una sola vez. Regenerarla invalida la anterior.',
  })
  @ApiResponse({ status: 201, type: PortalCredentialsDto })
  @ApiResponse({
    status: 409,
    description: 'Otro acceso del portal ya usa ese email',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El inquilino no tiene email',
    type: ApiErrorDto,
  })
  async issuePortalCredentials(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PortalCredentials>> {
    const credentials = await this.commandBus.execute<
      IssueRenterPortalCredentialsCommand,
      PortalCredentials
    >(new IssueRenterPortalCredentialsCommand(id))
    return {
      success: true,
      message: 'Acceso al portal generado',
      data: credentials,
    }
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar (borrado lógico, sólo admin)',
    description: 'Con un contrato activo no se puede: 409.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeleteRenterCommand, void>(
      new DeleteRenterCommand(id),
    )
  }
}
