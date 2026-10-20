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
  CreateGuarantorCommand,
  DeleteGuarantorCommand,
  UpdateGuarantorCommand,
} from '@/modules/renters/application/commands/guarantor.commands'
import {
  CheckGuarantorDataQuery,
  GetGuarantorQuery,
  GuarantorDataCheck,
  ListGuarantorsQuery,
} from '@/modules/renters/application/queries/guarantor.queries'
import {
  GuarantorDetailView,
  GuarantorSummaryView,
} from '@/modules/renters/application/renter.views'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  CheckGuarantorDataQueryDto,
  CreateGuarantorDto,
  GuarantorDataCheckDto,
  GuarantorDetailDto,
  GuarantorSummaryDto,
  ListGuarantorsQueryDto,
  UpdateGuarantorDto,
} from '../dtos/guarantor.dtos'

/**
 * Garantes (spec Fase 8, 3.2). Admin y empleado operan; borrar es sólo admin.
 */
@ApiTags('Guarantors')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'guarantors' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class GuarantorsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar, con búsqueda por nombre o DNI',
    description: 'Cada garante trae cuántos inquilinos garantiza.',
  })
  @ApiPaginatedResponse(GuarantorSummaryDto, 'Garantes de la inmobiliaria')
  async list(
    @Query() query: ListGuarantorsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<GuarantorSummaryView>>> {
    const result = await this.queryBus.execute<
      ListGuarantorsQuery,
      PaginatedResult<GuarantorSummaryView>
    >(
      new ListGuarantorsQuery(
        { search: query.search || undefined },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  // Antes de `:id`, para que "check" no se lea como un id.
  @Get('check')
  @ApiOperation({
    summary: 'Chequear el DNI mientras se completa el formulario',
    description:
      'Si el DNI ya está cargado, el formulario de inquilino puede ofrecer elegirlo en vez de crearlo.',
  })
  @ApiResponse({ status: 200, type: GuarantorDataCheckDto })
  async check(
    @Query() query: CheckGuarantorDataQueryDto,
  ): Promise<ApiSuccessDto<GuarantorDataCheck>> {
    const result = await this.queryBus.execute<
      CheckGuarantorDataQuery,
      GuarantorDataCheck
    >(new CheckGuarantorDataQuery(query.nationalId, query.excludeId))
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha completa, con los inquilinos que garantiza' })
  @ApiResponse({ status: 200, type: GuarantorDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<GuarantorDetailView>> {
    const guarantor = await this.queryBus.execute<
      GetGuarantorQuery,
      GuarantorDetailView
    >(new GetGuarantorQuery(id))
    return { success: true, message: null, data: guarantor }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Alta' })
  @ApiResponse({ status: 201, type: GuarantorDetailDto })
  @ApiResponse({
    status: 400,
    description: 'DNI inválido o detalle de la garantía vacío',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ya hay un garante con ese DNI',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateGuarantorDto,
  ): Promise<ApiSuccessDto<GuarantorDetailView>> {
    const guarantor = await this.commandBus.execute<
      CreateGuarantorCommand,
      GuarantorDetailView
    >(
      new CreateGuarantorCommand({
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        phone: dto.phone ?? null,
        email: dto.email ?? null,
        address: dto.address ?? null,
        guaranteeType: dto.guaranteeType,
        guaranteeDetail: dto.guaranteeDetail,
        notes: dto.notes ?? null,
      }),
    )
    return { success: true, message: 'Garante creado', data: guarantor }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar' })
  @ApiResponse({ status: 200, type: GuarantorDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateGuarantorDto,
  ): Promise<ApiSuccessDto<GuarantorDetailView>> {
    const guarantor = await this.commandBus.execute<
      UpdateGuarantorCommand,
      GuarantorDetailView
    >(
      new UpdateGuarantorCommand(id, {
        firstName: dto.firstName,
        lastName: dto.lastName,
        nationalId: dto.nationalId,
        phone: dto.phone,
        email: dto.email,
        address: dto.address,
        guaranteeType: dto.guaranteeType,
        guaranteeDetail: dto.guaranteeDetail,
        notes: dto.notes,
      }),
    )
    return { success: true, message: 'Garante actualizado', data: guarantor }
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar (borrado lógico, sólo admin)',
    description: 'Si algún inquilino lo tiene de garante no se puede: 409.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeleteGuarantorCommand, void>(
      new DeleteGuarantorCommand(id),
    )
  }
}
