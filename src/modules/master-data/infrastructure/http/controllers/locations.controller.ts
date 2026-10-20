import {
  Body,
  Controller,
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
  CreateLocationCommand,
  RenameLocationCommand,
  SetLocationActiveCommand,
} from '@/modules/master-data/application/commands/location.commands'
import {
  GetLocationQuery,
  GetLocationTreeQuery,
  ListLocationsQuery,
} from '@/modules/master-data/application/queries/location.queries'
import { Location, LocationNode } from '@/modules/master-data/domain/location'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  CreateLocationDto,
  ListLocationsQueryDto,
  ListMasterDataQueryDto,
  LocationDto,
  LocationNodeDto,
  RenameLocationDto,
  toActiveFilter,
} from '../dtos/master-data.dtos'

/**
 * Ubicaciones (spec Fase 5, 3.1): jerárquicas, País → Provincia → Localidad
 * → Barrio. Leer: admin y empleado. Escribir: sólo admin.
 */
@ApiTags('Master data')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'locations' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class LocationsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Listar, filtrando por nivel y por padre',
    description:
      'Para los selects en cascada: ?parentId=<provincia> trae sus localidades.',
  })
  @ApiResponse({ status: 200, type: [LocationDto] })
  async list(
    @Query() query: ListLocationsQueryDto,
  ): Promise<ApiSuccessDto<Location[]>> {
    const locations = await this.queryBus.execute<
      ListLocationsQuery,
      Location[]
    >(
      new ListLocationsQuery({
        level: query.level,
        parentId: query.parentId,
        active: toActiveFilter(query.isActive),
      }),
    )
    return { success: true, message: null, data: locations }
  }

  // Va antes de `:id` para que "tree" no se tome como un id.
  @Get('tree')
  @ApiOperation({ summary: 'El árbol completo, anidado' })
  @ApiResponse({ status: 200, type: [LocationNodeDto] })
  async tree(
    @Query() query: ListMasterDataQueryDto,
  ): Promise<ApiSuccessDto<LocationNode[]>> {
    const tree = await this.queryBus.execute<
      GetLocationTreeQuery,
      LocationNode[]
    >(new GetLocationTreeQuery(toActiveFilter(query.isActive)))
    return { success: true, message: null, data: tree }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver una' })
  @ApiResponse({ status: 200, type: LocationDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<Location>> {
    const location = await this.queryBus.execute<GetLocationQuery, Location>(
      new GetLocationQuery(id),
    )
    return { success: true, message: null, data: location }
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear (sólo admin)' })
  @ApiResponse({ status: 201, type: LocationDto })
  @ApiResponse({
    status: 400,
    description: 'Falta el padre (todo menos un país lo necesita)',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'Ya existe con ese nombre en el mismo padre',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El padre no existe o no puede contenerla',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateLocationDto,
  ): Promise<ApiSuccessDto<Location>> {
    const location = await this.commandBus.execute<
      CreateLocationCommand,
      Location
    >(new CreateLocationCommand(dto.level, dto.name, dto.parentId ?? null))
    return { success: true, message: 'Ubicación creada', data: location }
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Renombrar (sólo admin)' })
  @ApiResponse({ status: 200, type: LocationDto })
  async rename(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenameLocationDto,
  ): Promise<ApiSuccessDto<Location>> {
    const location = await this.commandBus.execute<
      RenameLocationCommand,
      Location
    >(new RenameLocationCommand(id, dto.name))
    return { success: true, message: 'Ubicación actualizada', data: location }
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Desactivar (sólo admin)' })
  @ApiResponse({ status: 200, type: LocationDto })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<Location>> {
    return this.setActive(id, false)
  }

  @Patch(':id/activate')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Reactivar (sólo admin)',
    description: 'Se permite aunque el padre esté desactivado.',
  })
  @ApiResponse({ status: 200, type: LocationDto })
  async activate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<Location>> {
    return this.setActive(id, true)
  }

  private async setActive(
    id: string,
    isActive: boolean,
  ): Promise<ApiSuccessDto<Location>> {
    const location = await this.commandBus.execute<
      SetLocationActiveCommand,
      Location
    >(new SetLocationActiveCommand(id, isActive))
    return {
      success: true,
      message: isActive ? 'Ubicación reactivada' : 'Ubicación desactivada',
      data: location,
    }
  }
}
