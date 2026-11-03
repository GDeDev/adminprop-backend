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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import { FileInterceptor } from '@nestjs/platform-express'
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { EXPORT_CONTENT_TYPES, sendAttachment } from '@/shared/files/attachment'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ImportBatchDetailView,
  ImportBatchSummaryView,
  ImportRowView,
} from '../../../application/batch.views'
import {
  ConfirmImportCommand,
  DiscardImportCommand,
  GetExcelTemplateQuery,
  GetImportBatchQuery,
  GetImportReportQuery,
  ListImportBatchesQuery,
  ListImportRowsQuery,
  RetryImportAssetsCommand,
  StartExcelAnalysisCommand,
  StartTokkoAnalysisCommand,
  UpdateImportRowCommand,
} from '../../../application/migration.commands'
import { StartedMigration } from '../../../application/migration.handlers'
import { InvalidXlsxException } from '../../../domain/migration.exceptions'
import { MAX_FILE_BYTES } from '../../../domain/template-definition'
import {
  AnalyzeTokkoDto,
  ConfirmImportDto,
  ImportBatchDetailDto,
  ImportBatchSummaryDto,
  ImportRowDto,
  ListBatchesQueryDto,
  ListRowsQueryDto,
  RetryAssetsResultDto,
  StartMigrationResultDto,
  UpdateImportRowDto,
} from '../dtos/migration.dtos'

const XLSX_MIME = EXPORT_CONTENT_TYPES.xlsx

const ok = <T>(data: T, message: string | null = null): ApiSuccessDto<T> => ({
  success: true,
  message,
  data,
})

/**
 * Migración de datos (Fase 21), sólo para el administrador. Todo es en dos
 * pasos sobre el mismo lote: se analiza (nada se crea) y recién después se
 * confirma lo que se revisó. Lo pesado responde 202 con un `jobId` que se
 * consulta en `GET /jobs/:id/status`.
 */
@ApiTags('Migration')
@ApiBearerAuth()
@Roles(Role.ADMIN)
@Controller({ path: 'migration' })
@ApiResponse({
  status: 403,
  description: 'Sólo el administrador migra datos',
  type: ApiErrorDto,
})
export class MigrationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  // ------------------------------------------------------------------ Excel

  @Get('excel/template')
  @ApiOperation({
    summary: 'Descargar la plantilla de Excel',
    description:
      'Hojas Instrucciones, Propietarios, Garantes, Inquilinos, Propiedades y Contratos, con desplegables armados con los maestros de la inmobiliaria.',
  })
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'El .xlsx' })
  async template(@Res() res: Response): Promise<void> {
    const buffer = await this.queryBus.execute<GetExcelTemplateQuery, Buffer>(
      new GetExcelTemplateQuery(),
    )
    sendAttachment(res, {
      buffer,
      filename: 'plantilla-migracion-adminprop.xlsx',
      contentType: XLSX_MIME,
    })
  }

  @Post('excel/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  @ApiOperation({
    summary: 'Analizar un Excel (dry-run)',
    description:
      'Multipart: `file` (.xlsx, hasta 10 MB y 5.000 filas). No crea ninguna entidad: arma un lote con las filas validadas para revisar.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 202, type: StartMigrationResultDto })
  @ApiResponse({
    status: 422,
    description:
      'INVALID_XLSX, TEMPLATE_VERSION_MISMATCH o IMPORT_TOO_MANY_ROWS',
    type: ApiErrorDto,
  })
  async analyzeExcel(
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<StartedMigration>> {
    if (!file) throw new InvalidXlsxException('Falta el archivo (campo «file»)')
    const started = await this.commandBus.execute<
      StartExcelAnalysisCommand,
      StartedMigration
    >(
      new StartExcelAnalysisCommand({
        buffer: file.buffer,
        originalName: file.originalname,
      }),
    )
    return ok(started, 'Análisis en curso')
  }

  // ------------------------------------------------------------------ Tokko

  @Post('tokko/analyze')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Analizar el stock de Tokko (dry-run)',
    description:
      'Siempre es un análisis: no hay "importar directo". Con `TOKKO_SOURCE=fixture` usa una muestra incluida; con `http`, la API real.',
  })
  @ApiResponse({ status: 202, type: StartMigrationResultDto })
  async analyzeTokko(
    @Body() dto: AnalyzeTokkoDto,
  ): Promise<ApiSuccessDto<StartedMigration>> {
    const started = await this.commandBus.execute<
      StartTokkoAnalysisCommand,
      StartedMigration
    >(
      new StartTokkoAnalysisCommand({
        operationTypes: dto.operationTypes,
        limit: dto.limit,
        includeAssets: dto.includeAssets,
      }),
    )
    return ok(started, 'Análisis en curso')
  }

  // ------------------------------------------------------------------ Lotes

  @Get('batches')
  @ApiOperation({ summary: 'Historial de lotes' })
  @ApiPaginatedResponse(ImportBatchSummaryDto, 'Lotes de la inmobiliaria')
  async list(
    @Query() query: ListBatchesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<ImportBatchSummaryView>>> {
    const result = await this.queryBus.execute<
      ListImportBatchesQuery,
      PaginatedResult<ImportBatchSummaryView>
    >(
      new ListImportBatchesQuery(
        { source: query.source, status: query.status },
        { page: query.page, limit: query.limit },
      ),
    )
    return ok(result)
  }

  @Get('batches/:id')
  @ApiOperation({ summary: 'Resumen y reporte de un lote' })
  @ApiResponse({ status: 200, type: ImportBatchDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<ImportBatchDetailView>> {
    return ok(
      await this.queryBus.execute<GetImportBatchQuery, ImportBatchDetailView>(
        new GetImportBatchQuery(id),
      ),
    )
  }

  @Get('batches/:id/rows')
  @ApiOperation({ summary: 'Filas del lote, con filtros' })
  @ApiPaginatedResponse(ImportRowDto, 'Filas del lote')
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async rows(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: ListRowsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<ImportRowView>>> {
    const result = await this.queryBus.execute<
      ListImportRowsQuery,
      PaginatedResult<ImportRowView>
    >(
      new ListImportRowsQuery(
        id,
        {
          entity: query.entity,
          status: query.status,
          needsReview: query.needsReview,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return ok(result)
  }

  @Patch('batches/:id/rows/:rowId')
  @ApiOperation({
    summary: 'Excluir una fila o elegir cómo resolver su conflicto',
    description: 'Sólo mientras el lote está pendiente de revisión (READY).',
  })
  @ApiResponse({ status: 200, type: ImportRowDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'BATCH_NOT_READY',
    type: ApiErrorDto,
  })
  async updateRow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('rowId', new ParseUUIDPipe()) rowId: string,
    @Body() dto: UpdateImportRowDto,
  ): Promise<ApiSuccessDto<ImportRowView>> {
    return ok(
      await this.commandBus.execute<UpdateImportRowCommand, ImportRowView>(
        new UpdateImportRowCommand(id, rowId, {
          excluded: dto.excluded,
          resolution: dto.resolution,
        }),
      ),
    )
  }

  @Post('batches/:id/confirm')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Confirmar el lote revisado',
    description:
      'Importa exactamente las filas analizadas. Las filas con error se omiten solas. Un conflicto se saltea por defecto; `MERGE_EMPTY_FIELDS` sólo completa campos vacíos, nunca pisa un valor cargado.',
  })
  @ApiResponse({ status: 202, type: StartMigrationResultDto })
  @ApiResponse({
    status: 409,
    description: 'BATCH_NOT_READY o BATCH_ALREADY_CONFIRMED',
    type: ApiErrorDto,
  })
  async confirm(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ConfirmImportDto,
  ): Promise<ApiSuccessDto<StartedMigration>> {
    const started = await this.commandBus.execute<
      ConfirmImportCommand,
      StartedMigration
    >(
      new ConfirmImportCommand(id, {
        excludeRowIds: dto.excludeRowIds ?? [],
        defaultConflictResolution: dto.defaultConflictResolution,
        migrateAssets: dto.migrateAssets,
      }),
    )
    return ok(started, 'Importación en curso')
  }

  @Post('batches/:id/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Descartar el lote sin importar nada' })
  @ApiResponse({ status: 200, type: ImportBatchDetailDto })
  @ApiResponse({
    status: 409,
    description: 'BATCH_NOT_READY',
    type: ApiErrorDto,
  })
  async discard(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<ImportBatchDetailView>> {
    return ok(
      await this.commandBus.execute<
        DiscardImportCommand,
        ImportBatchDetailView
      >(new DiscardImportCommand(id)),
      'Lote descartado',
    )
  }

  @Post('batches/:id/assets/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Reintentar sólo las fotos que fallaron' })
  @ApiResponse({ status: 202, type: RetryAssetsResultDto })
  @ApiResponse({
    status: 409,
    description: 'BATCH_NOT_IMPORTED',
    type: ApiErrorDto,
  })
  async retryAssets(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    return ok(
      await this.commandBus.execute<
        RetryImportAssetsCommand,
        { jobId: string }
      >(new RetryImportAssetsCommand(id)),
      'Reintento de fotos en curso',
    )
  }

  @Get('batches/:id/report.xlsx')
  @ApiOperation({
    summary: 'Descargar el reporte del lote',
    description:
      'Una hoja con los errores y conflictos (fila, campo, mensaje) para corregir y volver a subir, y otra con las fotos por propiedad.',
  })
  @ApiProduces(XLSX_MIME)
  @ApiResponse({ status: 200, description: 'El .xlsx' })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async report(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res() res: Response,
  ): Promise<void> {
    const buffer = await this.queryBus.execute<GetImportReportQuery, Buffer>(
      new GetImportReportQuery(id),
    )
    sendAttachment(res, {
      buffer,
      filename: `reporte-migracion-${id.slice(0, 8)}.xlsx`,
      contentType: XLSX_MIME,
    })
  }
}
