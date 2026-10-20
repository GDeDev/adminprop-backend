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
  CreateOwnerCommand,
  DeleteOwnerCommand,
  IssueOwnerPortalCredentialsCommand,
  UpdateOwnerBankAccountCommand,
  UpdateOwnerCommand,
} from '@/modules/owners/application/commands/owner.commands'
import {
  OwnerDetailView,
  OwnerSummaryView,
} from '@/modules/owners/application/owner.views'
import {
  CheckOwnerDataQuery,
  GetOwnerQuery,
  ListOwnersQuery,
  OwnerDataCheck,
} from '@/modules/owners/application/queries/owner.queries'
import { BankAccount } from '@/modules/owners/domain/owner'
import {
  PortalCredentials,
  PortalCredentialsDto,
  Role,
  Roles,
} from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  BankAccountDto,
  CheckOwnerDataQueryDto,
  CreateOwnerDto,
  ListOwnersQueryDto,
  OwnerDataCheckDto,
  OwnerDetailDto,
  OwnerSummaryDto,
  UpdateOwnerDto,
} from '../dtos/owner.dtos'

function toBankAccount(dto: BankAccountDto | undefined): BankAccount {
  return {
    cbu: dto?.cbu ?? null,
    alias: dto?.alias ?? null,
    bankName: dto?.bankName ?? null,
    holder: dto?.holder ?? null,
  }
}

/**
 * Propietarios (spec Fase 7). Admin y empleado operan; borrar es sólo admin.
 */
@ApiTags('Owners')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'owners' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class OwnersController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar, con búsqueda por nombre o DNI',
    description:
      'Cada propietario trae sus propiedades y si aplica el honorario reducido. ' +
      'El filtro "con deuda" llega con la Fase 11.',
  })
  @ApiPaginatedResponse(OwnerSummaryDto, 'Propietarios de la inmobiliaria')
  async list(
    @Query() query: ListOwnersQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<OwnerSummaryView>>> {
    const result = await this.queryBus.execute<
      ListOwnersQuery,
      PaginatedResult<OwnerSummaryView>
    >(
      new ListOwnersQuery(
        { search: query.search || undefined },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  // Antes de `:id`, para que "check" no se lea como un id.
  @Get('check')
  @ApiOperation({
    summary: 'Chequear DNI y CBU mientras se completa el formulario',
    description:
      'El DNI repetido bloquea el alta; el CBU repetido sólo se advierte.',
  })
  @ApiResponse({ status: 200, type: OwnerDataCheckDto })
  async check(
    @Query() query: CheckOwnerDataQueryDto,
  ): Promise<ApiSuccessDto<OwnerDataCheck>> {
    const result = await this.queryBus.execute<
      CheckOwnerDataQuery,
      OwnerDataCheck
    >(new CheckOwnerDataQuery(query.nationalId, query.cbu, query.excludeId))
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha completa, con sus propiedades' })
  @ApiResponse({ status: 200, type: OwnerDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<OwnerDetailView>> {
    const owner = await this.queryBus.execute<GetOwnerQuery, OwnerDetailView>(
      new GetOwnerQuery(id),
    )
    return { success: true, message: null, data: owner }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Alta' })
  @ApiResponse({ status: 201, type: OwnerDetailDto })
  @ApiResponse({
    status: 400,
    description: 'DNI o CBU inválido',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ya hay un propietario con ese DNI',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateOwnerDto,
  ): Promise<ApiSuccessDto<OwnerDetailView>> {
    const owner = await this.commandBus.execute<
      CreateOwnerCommand,
      OwnerDetailView
    >(
      new CreateOwnerCommand(
        {
          firstName: dto.firstName,
          lastName: dto.lastName,
          nationalId: dto.nationalId,
          phone: dto.phone ?? null,
          email: dto.email ?? null,
          address: dto.address ?? null,
          notes: dto.notes ?? null,
        },
        toBankAccount(dto.bankAccount),
      ),
    )
    return { success: true, message: 'Propietario creado', data: owner }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar los datos personales' })
  @ApiResponse({ status: 200, type: OwnerDetailDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateOwnerDto,
  ): Promise<ApiSuccessDto<OwnerDetailView>> {
    const owner = await this.commandBus.execute<
      UpdateOwnerCommand,
      OwnerDetailView
    >(
      new UpdateOwnerCommand(id, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        notes: dto.notes,
      }),
    )
    return { success: true, message: 'Propietario actualizado', data: owner }
  }

  @Patch(':id/bank-account')
  @ApiOperation({
    summary: 'Cambiar la cuenta bancaria',
    description:
      'Reemplaza la cuenta entera. Queda en la auditoría como un cambio aparte.',
  })
  @ApiResponse({ status: 200, type: OwnerDetailDto })
  @ApiResponse({ status: 400, description: 'CBU inválido', type: ApiErrorDto })
  async updateBankAccount(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: BankAccountDto,
  ): Promise<ApiSuccessDto<OwnerDetailView>> {
    const owner = await this.commandBus.execute<
      UpdateOwnerBankAccountCommand,
      OwnerDetailView
    >(new UpdateOwnerBankAccountCommand(id, toBankAccount(dto)))
    return {
      success: true,
      message: 'Cuenta bancaria actualizada',
      data: owner,
    }
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
    description: 'El propietario no tiene email',
    type: ApiErrorDto,
  })
  async issuePortalCredentials(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PortalCredentials>> {
    const credentials = await this.commandBus.execute<
      IssueOwnerPortalCredentialsCommand,
      PortalCredentials
    >(new IssueOwnerPortalCredentialsCommand(id))
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
    description: 'Con propiedades asignadas no se puede: 409.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeleteOwnerCommand, void>(
      new DeleteOwnerCommand(id),
    )
  }
}
