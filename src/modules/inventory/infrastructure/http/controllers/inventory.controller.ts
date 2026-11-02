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
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { FilesInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import {
  AddInventoryPhotosCommand,
  ConfirmInventoryCommand,
  CorrectInventoryCommand,
  CreateInventoryCommand,
  DeleteInventoryPhotoCommand,
  UpdateInventoryCommand,
} from '@/modules/inventory/application/inventory.commands'
import {
  CompareInventoriesQuery,
  GetInventoryQuery,
  ListContractInventoriesQuery,
} from '@/modules/inventory/application/inventory.queries'
import {
  ContractInventoriesView,
  InventoryDetailView,
} from '@/modules/inventory/application/inventory.views'
import {
  MAX_PHOTO_BYTES,
  MAX_PHOTOS_PER_ITEM,
  MAX_PHOTOS_PER_UPLOAD,
} from '@/modules/inventory/domain/inventory'
import { InventoryComparison } from '@/modules/inventory/domain/inventory-comparison'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  ContractInventoriesDto,
  CorrectInventoryDto,
  CreateInventoryDto,
  InventoryComparisonDto,
  InventoryDetailDto,
  UpdateInventoryDto,
} from '../dtos/inventory.dtos'

/**
 * Inventario del inmueble (spec Fase 25, rediseño 2). Admin y empleado hacen
 * todo; no hay baja: un acta confirmada se corrige, no se borra.
 */
@ApiTags('Inventories')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller()
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class InventoryController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('contracts/:contractId/inventories')
  @ApiOperation({
    summary: 'Inventarios vigentes de un contrato',
    description:
      'Los no reemplazados, con si se puede crear el de entrega y el de devolución.',
  })
  @ApiResponse({ status: 200, type: ContractInventoriesDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async list(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ): Promise<ApiSuccessDto<ContractInventoriesView>> {
    const data = await this.queryBus.execute<
      ListContractInventoriesQuery,
      ContractInventoriesView
    >(new ListContractInventoriesQuery(contractId))
    return { success: true, message: null, data }
  }

  @Get('contracts/:contractId/inventories/compare')
  @ApiOperation({
    summary: 'Comparar la entrega con la devolución',
    description:
      'Usa los inventarios vigentes y confirmados. Si falta uno, `hasDelivery`/`hasReturn` lo avisa.',
  })
  @ApiResponse({ status: 200, type: InventoryComparisonDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async compare(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
  ): Promise<ApiSuccessDto<InventoryComparison>> {
    const data = await this.queryBus.execute<
      CompareInventoriesQuery,
      InventoryComparison
    >(new CompareInventoriesQuery(contractId))
    return { success: true, message: null, data }
  }

  @Post('contracts/:contractId/inventories')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear un inventario en borrador',
    description:
      'Sin `items` se precarga la plantilla estándar con todo en "No aplica". Un solo vigente por tipo (409 `INVENTORY_ALREADY_EXISTS`); la devolución sólo con el contrato no activo o a 30 días o menos de su fin (422 `INVENTORY_RETURN_NOT_ALLOWED`).',
  })
  @ApiResponse({ status: 201, type: InventoryDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async create(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() dto: CreateInventoryDto,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      CreateInventoryCommand,
      InventoryDetailView
    >(
      new CreateInventoryCommand(contractId, {
        type: dto.type,
        date: dto.date,
        generalNotes: dto.generalNotes,
        items: dto.items?.map((item) => ({
          ...item,
          notes: item.notes ?? null,
        })),
      }),
    )
    return { success: true, message: 'Inventario creado', data }
  }

  @Get('inventories/:id')
  @ApiOperation({ summary: 'Detalle de un inventario, con ítems y fotos' })
  @ApiResponse({ status: 200, type: InventoryDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async get(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.queryBus.execute<
      GetInventoryQuery,
      InventoryDetailView
    >(new GetInventoryQuery(id))
    return { success: true, message: null, data }
  }

  @Patch('inventories/:id')
  @ApiOperation({
    summary: 'Editar un borrador',
    description:
      'Fecha, notas, conformidad del inquilino y la lista de ítems (la reemplaza). Confirmado no se edita (409 `INVENTORY_CONFIRMED`).',
  })
  @ApiResponse({ status: 200, type: InventoryDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInventoryDto,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      UpdateInventoryCommand,
      InventoryDetailView
    >(
      new UpdateInventoryCommand(id, {
        date: dto.date,
        generalNotes: dto.generalNotes,
        tenantAcknowledged: dto.tenantAcknowledged,
        items: dto.items?.map((item) => ({
          ...item,
          notes: item.notes ?? null,
        })),
      }),
    )
    return { success: true, message: 'Inventario actualizado', data }
  }

  @Post('inventories/:id/items/:itemId/photos')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FilesInterceptor('files', MAX_PHOTOS_PER_UPLOAD, {
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  @ApiOperation({
    summary: `Subir fotos a un ítem (hasta ${MAX_PHOTOS_PER_UPLOAD} por pedido y ${MAX_PHOTOS_PER_ITEM} por ítem)`,
    description:
      'Multipart: `files`. JPG, PNG, WebP o HEIC reconocidos por su contenido, hasta 10 MB cada una. Sólo en borrador.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['files'],
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiResponse({ status: 201, type: InventoryDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async addPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('itemId', new ParseUUIDPipe()) itemId: string,
    @UploadedFiles() files: Express.Multer.File[] | undefined,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      AddInventoryPhotosCommand,
      InventoryDetailView
    >(
      new AddInventoryPhotosCommand(
        id,
        itemId,
        (files ?? []).map((file) => file.buffer),
      ),
    )
    return { success: true, message: 'Fotos agregadas', data }
  }

  @Delete('inventories/:id/photos/:photoId')
  @ApiOperation({ summary: 'Borrar una foto de un borrador' })
  @ApiResponse({ status: 200, type: InventoryDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async deletePhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      DeleteInventoryPhotoCommand,
      InventoryDetailView
    >(new DeleteInventoryPhotoCommand(id, photoId))
    return { success: true, message: 'Foto borrada', data }
  }

  @Post('inventories/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirmar el inventario',
    description:
      'Lo cierra para siempre. Exige al menos un ítem evaluado (422 `INVENTORY_EMPTY`). `warnings` lista los ítems en mal estado sin fotos.',
  })
  @ApiResponse({ status: 200, type: InventoryDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      ConfirmInventoryCommand,
      InventoryDetailView
    >(new ConfirmInventoryCommand(id))
    return { success: true, message: 'Inventario confirmado', data }
  }

  @Post('inventories/:id/correct')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear una corrección de un inventario confirmado',
    description:
      'Copia el inventario en un borrador nuevo con el motivo. Al confirmarla reemplaza al original.',
  })
  @ApiResponse({ status: 201, type: InventoryDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async correct(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CorrectInventoryDto,
  ): Promise<ApiSuccessDto<InventoryDetailView>> {
    const data = await this.commandBus.execute<
      CorrectInventoryCommand,
      InventoryDetailView
    >(new CorrectInventoryCommand(id, dto.reason))
    return { success: true, message: 'Corrección creada', data }
  }
}
