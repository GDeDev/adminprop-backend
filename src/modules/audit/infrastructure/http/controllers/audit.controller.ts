import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
} from '@nestjs/common'
import { QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { Attachment, sendAttachment } from '@/shared/files/attachment'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ExportAuditQuery,
  GetAuditCatalogQuery,
  GetAuditEntryQuery,
  ListAuditQuery,
  ListEntityHistoryQuery,
} from '../../../application/audit.queries'
import {
  AuditCatalogView,
  AuditEntryDetailView,
  AuditEntryView,
} from '../../../application/audit.views'
import {
  AuditCatalogDto,
  AuditEntryDetailDto,
  AuditEntryDto,
  EntityHistoryQueryDto,
  ExportAuditQueryDto,
  ListAuditQueryDto,
} from '../dtos/audit.dtos'

/**
 * Auditoría (Fase 20): historial de cambios y de eventos de la inmobiliaria.
 * Sólo el admin lo ve; el empleado recibe 403. Es de sólo lectura: las filas
 * no se pueden editar ni borrar ni siquiera por la base (trigger).
 *
 * Las rutas fijas (`entities`, `export`, `entity/...`) van antes que `:id`.
 */
@ApiTags('Audit')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller({ path: 'audit' })
@ApiResponse({ status: 403, description: 'Sólo el admin', type: ApiErrorDto })
export class AuditController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get()
  @ApiOperation({
    summary: 'Listar los movimientos de auditoría',
    description:
      'Más nuevos primero. Filtra por entidad, acción, usuario, tipo de actor, fechas y texto.',
  })
  @ApiPaginatedResponse(AuditEntryDto, 'Movimientos de la página')
  async list(
    @Query() query: ListAuditQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<AuditEntryView>>> {
    const { page, limit, ...filter } = query
    const data = await this.queryBus.execute<
      ListAuditQuery,
      PaginatedResult<AuditEntryView>
    >(new ListAuditQuery(filter, { page, limit }))
    return { success: true, message: null, data }
  }

  @Get('entities')
  @ApiOperation({
    summary: 'Catálogo de entidades y acciones',
    description: 'Para armar los filtros de la pantalla.',
  })
  @ApiResponse({ status: 200, type: AuditCatalogDto })
  async catalog(): Promise<ApiSuccessDto<AuditCatalogView>> {
    const data = await this.queryBus.execute<
      GetAuditCatalogQuery,
      AuditCatalogView
    >(new GetAuditCatalogQuery())
    return { success: true, message: null, data }
  }

  @Get('export')
  @ApiOperation({
    summary: 'Exportar la auditoría filtrada',
    description:
      'Devuelve el archivo (Content-Disposition). Hasta 5.000 movimientos; con más, acotar por fecha. La exportación queda auditada.',
  })
  @ApiProduces(
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  )
  @ApiOkResponse({ description: 'Archivo XLSX o CSV' })
  async export(
    @Query() query: ExportAuditQueryDto,
    @Res() res: Response,
  ): Promise<void> {
    const { format, ...filter } = query
    const file = await this.queryBus.execute<ExportAuditQuery, Attachment>(
      new ExportAuditQuery(filter, format),
    )
    sendAttachment(res, file)
  }

  @Get('entity/:entity/:entityId')
  @ApiOperation({
    summary: 'Historial de una ficha',
    description:
      'Los últimos cambios de una entidad (pestaña "Historial"), más nuevos primero.',
  })
  @ApiResponse({ status: 200, type: [AuditEntryDto] })
  async history(
    @Param('entity') entity: string,
    @Param('entityId') entityId: string,
    @Query() query: EntityHistoryQueryDto,
  ): Promise<ApiSuccessDto<AuditEntryView[]>> {
    const data = await this.queryBus.execute<
      ListEntityHistoryQuery,
      AuditEntryView[]
    >(new ListEntityHistoryQuery(entity, entityId, query.limit))
    return { success: true, message: null, data }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Detalle de un movimiento',
    description:
      'Con el diff campo por campo; si el valor es un id (propiedad, inquilino…), también su nombre.',
  })
  @ApiResponse({ status: 200, type: AuditEntryDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async detail(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<AuditEntryDetailView>> {
    const data = await this.queryBus.execute<
      GetAuditEntryQuery,
      AuditEntryDetailView
    >(new GetAuditEntryQuery(id))
    return { success: true, message: null, data }
  }
}
