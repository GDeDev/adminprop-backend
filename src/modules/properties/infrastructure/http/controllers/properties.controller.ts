import {
  Body,
  Controller,
  Delete,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
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
  AddPropertyPhotosCommand,
  ChangePropertyStatusCommand,
  CreatePropertyCommand,
  DeletePropertyCommand,
  DeletePropertyPhotoCommand,
  UpdatePropertyCommand,
} from '@/modules/properties/application/commands/property.commands'
import {
  GetPropertyQuery,
  ListPropertiesQuery,
} from '@/modules/properties/application/queries/property.queries'
import {
  PropertyDetailView,
  PropertySummaryView,
} from '@/modules/properties/application/property.views'
import { MAX_PHOTOS_PER_PROPERTY } from '@/modules/properties/domain/property'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ChangePropertyStatusDto,
  CreatePropertyDto,
  ListPropertiesQueryDto,
  PropertyDetailDto,
  PropertySummaryDto,
  UpdatePropertyDto,
} from '../dtos/property.dtos'

/** 10 MB por foto: alcanza para una foto de celular y frena abusos. */
const MAX_PHOTO_BYTES = 10 * 1024 * 1024

/**
 * Propiedades (spec Fase 6). Admin y empleado operan; borrar es sólo admin.
 */
@ApiTags('Properties')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'properties' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class PropertiesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar, con filtros y búsqueda por dirección' })
  @ApiPaginatedResponse(PropertySummaryDto, 'Propiedades de la inmobiliaria')
  async list(
    @Query() query: ListPropertiesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<PropertySummaryView>>> {
    const result = await this.queryBus.execute<
      ListPropertiesQuery,
      PaginatedResult<PropertySummaryView>
    >(
      new ListPropertiesQuery(
        {
          status: query.status,
          ownerId: query.ownerId,
          propertyTypeId: query.propertyTypeId,
          search: query.search || undefined,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ficha completa' })
  @ApiResponse({ status: 200, type: PropertyDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.queryBus.execute<
      GetPropertyQuery,
      PropertyDetailView
    >(new GetPropertyQuery(id))
    return { success: true, message: null, data: property }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Alta (queda disponible)' })
  @ApiResponse({ status: 201, type: PropertyDetailDto })
  @ApiResponse({
    status: 422,
    description: 'Ubicación, tipo o amenity inexistente o desactivado',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreatePropertyDto,
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.commandBus.execute<
      CreatePropertyCommand,
      PropertyDetailView
    >(
      new CreatePropertyCommand({
        address: dto.address,
        locationId: dto.locationId,
        propertyTypeId: dto.propertyTypeId,
        ownerId: dto.ownerId ?? null,
        amenityIds: dto.amenityIds ?? [],
        notes: dto.notes ?? null,
      }),
    )
    return { success: true, message: 'Propiedad creada', data: property }
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Editar (todo menos estado y fotos)' })
  @ApiResponse({ status: 200, type: PropertyDetailDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.commandBus.execute<
      UpdatePropertyCommand,
      PropertyDetailView
    >(
      new UpdatePropertyCommand(id, {
        address: dto.address,
        locationId: dto.locationId,
        propertyTypeId: dto.propertyTypeId,
        ownerId: dto.ownerId,
        amenityIds: dto.amenityIds,
        notes: dto.notes,
      }),
    )
    return { success: true, message: 'Propiedad actualizada', data: property }
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar el estado a mano' })
  @ApiResponse({ status: 200, type: PropertyDetailDto })
  @ApiResponse({
    status: 409,
    description: 'Tiene un contrato activo',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Transición no permitida',
    type: ApiErrorDto,
  })
  async changeStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ChangePropertyStatusDto,
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.commandBus.execute<
      ChangePropertyStatusCommand,
      PropertyDetailView
    >(new ChangePropertyStatusCommand(id, dto.status))
    return { success: true, message: 'Estado actualizado', data: property }
  }

  @Post(':id/photos')
  @UseInterceptors(
    FilesInterceptor('files', MAX_PHOTOS_PER_PROPERTY, {
      limits: { fileSize: MAX_PHOTO_BYTES },
    }),
  )
  @ApiOperation({
    summary: `Subir fotos (JPG, PNG o WebP, hasta ${MAX_PHOTOS_PER_PROPERTY} por propiedad)`,
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        files: { type: 'array', items: { type: 'string', format: 'binary' } },
      },
    },
  })
  @ApiResponse({ status: 201, type: PropertyDetailDto })
  @ApiResponse({
    status: 400,
    description: `Pasaría de ${MAX_PHOTOS_PER_PROPERTY} fotos, o archivo inválido`,
    type: ApiErrorDto,
  })
  async addPhotos(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFiles(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_PHOTO_BYTES }),
          new FileTypeValidator({ fileType: /^image\/(jpeg|png|webp)$/ }),
        ],
      }),
    )
    files: Express.Multer.File[],
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.commandBus.execute<
      AddPropertyPhotosCommand,
      PropertyDetailView
    >(
      new AddPropertyPhotosCommand(
        id,
        files.map((file) => ({ buffer: file.buffer, mimeType: file.mimetype })),
      ),
    )
    return { success: true, message: 'Fotos agregadas', data: property }
  }

  @Delete(':id/photos/:photoId')
  @ApiOperation({ summary: 'Borrar una foto' })
  @ApiResponse({ status: 200, type: PropertyDetailDto })
  async deletePhoto(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('photoId', new ParseUUIDPipe()) photoId: string,
  ): Promise<ApiSuccessDto<PropertyDetailView>> {
    const property = await this.commandBus.execute<
      DeletePropertyPhotoCommand,
      PropertyDetailView
    >(new DeletePropertyPhotoCommand(id, photoId))
    return { success: true, message: 'Foto borrada', data: property }
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar (borrado lógico, sólo admin)',
    description: 'Con historial de contratos no se puede: 409.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 409, type: ApiErrorDto })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeletePropertyCommand, void>(
      new DeletePropertyCommand(id),
    )
  }
}
