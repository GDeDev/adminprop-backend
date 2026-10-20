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
  CreateCatalogItemCommand,
  SetCatalogItemActiveCommand,
  UpdateCatalogItemCommand,
} from '@/modules/master-data/application/commands/catalog.commands'
import {
  GetCatalogItemQuery,
  ListCatalogItemsQuery,
} from '@/modules/master-data/application/queries/catalog.queries'
import { Catalog, CatalogItem } from '@/modules/master-data/domain/catalog'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  CatalogItemDto,
  CreateAmenityDto,
  CreateCatalogItemDto,
  ListMasterDataQueryDto,
  toActiveFilter,
  UpdateAmenityDto,
  UpdateCatalogItemDto,
} from '../dtos/master-data.dtos'

/**
 * Rutas comunes de los cuatro maestros planos (spec Fase 5, 3). Cada
 * subclase sólo dice su ruta y cuál es su `catalog`.
 *
 * Leer: admin y empleado (los selectores de las altas los usan todos).
 * Escribir: sólo admin.
 */
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
abstract class CatalogController {
  protected abstract readonly catalog: Catalog

  constructor(
    protected readonly commandBus: CommandBus,
    protected readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar (por defecto, sólo los activos)' })
  @ApiResponse({ status: 200, type: [CatalogItemDto] })
  async list(
    @Query() query: ListMasterDataQueryDto,
  ): Promise<ApiSuccessDto<CatalogItem[]>> {
    const items = await this.queryBus.execute<
      ListCatalogItemsQuery,
      CatalogItem[]
    >(new ListCatalogItemsQuery(this.catalog, toActiveFilter(query.isActive)))
    return { success: true, message: null, data: items }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver uno' })
  @ApiResponse({ status: 200, type: CatalogItemDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    const item = await this.queryBus.execute<GetCatalogItemQuery, CatalogItem>(
      new GetCatalogItemQuery(this.catalog, id),
    )
    return { success: true, message: null, data: item }
  }

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear (sólo admin)' })
  @ApiResponse({ status: 201, type: CatalogItemDto })
  @ApiResponse({
    status: 409,
    description: 'Nombre repetido',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateCatalogItemDto,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.createItem(dto.name, null)
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Editar el nombre (sólo admin)' })
  @ApiResponse({ status: 200, type: CatalogItemDto })
  @ApiResponse({
    status: 409,
    description: 'Nombre repetido',
    type: ApiErrorDto,
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCatalogItemDto,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.updateItem(id, { name: dto.name })
  }

  @Patch(':id/deactivate')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Desactivar (sólo admin)',
    description:
      'Sale de los selectores; lo que ya lo usa lo sigue mostrando. No se borra nunca.',
  })
  @ApiResponse({ status: 200, type: CatalogItemDto })
  async deactivate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.setActive(id, false)
  }

  @Patch(':id/activate')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Reactivar (sólo admin)' })
  @ApiResponse({ status: 200, type: CatalogItemDto })
  async activate(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.setActive(id, true)
  }

  protected async createItem(
    name: string,
    icon: string | null,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    const item = await this.commandBus.execute<
      CreateCatalogItemCommand,
      CatalogItem
    >(new CreateCatalogItemCommand(this.catalog, name, icon))
    return { success: true, message: 'Creado', data: item }
  }

  protected async updateItem(
    id: string,
    changes: { name?: string; icon?: string | null },
  ): Promise<ApiSuccessDto<CatalogItem>> {
    const item = await this.commandBus.execute<
      UpdateCatalogItemCommand,
      CatalogItem
    >(new UpdateCatalogItemCommand(this.catalog, id, changes))
    return { success: true, message: 'Actualizado', data: item }
  }

  private async setActive(
    id: string,
    isActive: boolean,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    const item = await this.commandBus.execute<
      SetCatalogItemActiveCommand,
      CatalogItem
    >(new SetCatalogItemActiveCommand(this.catalog, id, isActive))
    return {
      success: true,
      message: isActive ? 'Reactivado' : 'Desactivado',
      data: item,
    }
  }
}

@ApiTags('Master data')
@Controller({ path: Catalog.PROPERTY_TYPES })
export class PropertyTypesController extends CatalogController {
  protected readonly catalog = Catalog.PROPERTY_TYPES
}

@ApiTags('Master data')
@Controller({ path: Catalog.OPERATION_TYPES })
export class OperationTypesController extends CatalogController {
  protected readonly catalog = Catalog.OPERATION_TYPES
}

@ApiTags('Master data')
@Controller({ path: Catalog.SERVICE_TYPES })
export class ServiceTypesController extends CatalogController {
  protected readonly catalog = Catalog.SERVICE_TYPES
}

/** Amenities: lo mismo, más el ícono. */
@ApiTags('Master data')
@Controller({ path: Catalog.AMENITIES })
export class AmenitiesController extends CatalogController {
  protected readonly catalog = Catalog.AMENITIES

  @Post()
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear (sólo admin)' })
  @ApiResponse({ status: 201, type: CatalogItemDto })
  @ApiResponse({
    status: 409,
    description: 'Nombre repetido',
    type: ApiErrorDto,
  })
  override async create(
    @Body() dto: CreateAmenityDto,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.createItem(dto.name, dto.icon ?? null)
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Editar nombre o ícono (sólo admin)' })
  @ApiResponse({ status: 200, type: CatalogItemDto })
  @ApiResponse({
    status: 409,
    description: 'Nombre repetido',
    type: ApiErrorDto,
  })
  override async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAmenityDto,
  ): Promise<ApiSuccessDto<CatalogItem>> {
    return this.updateItem(id, { name: dto.name, icon: dto.icon })
  }
}
