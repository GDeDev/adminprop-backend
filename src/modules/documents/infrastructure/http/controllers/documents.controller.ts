import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
} from '@nestjs/common'
import { CommandBus, QueryBus } from '@nestjs/cqrs'
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'
import type { Response } from 'express'

import {
  AuthenticatedUser,
  CurrentUser,
  Role,
  Roles,
} from '@/modules/auth/public'
import {
  GetDocumentQuery,
  ListDocumentsQuery,
  RegenerateDocumentCommand,
} from '@/modules/documents/application/document.handlers'
import { GeneratedDocumentView } from '@/modules/documents/application/document.views'
import {
  DocumentKind,
  DocumentStatus,
} from '@/modules/documents/domain/document'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  GeneratedDocumentDto,
  ListDocumentsQueryDto,
} from '../dtos/document.dtos'

const KIND_PIPE = new ParseEnumPipe(DocumentKind, {
  exceptionFactory: () =>
    new BadRequestException(
      `El tipo de documento tiene que ser uno de: ${Object.values(DocumentKind).join(', ')}`,
    ),
})

/**
 * PDFs generados (Fase 15). Consulta para el personal y los portales (cada
 * usuario de portal sólo ve lo suyo); regeneración y listado, sólo admin.
 */
@ApiTags('Documents')
@ApiBearerAuth()
@Controller({ path: 'documents' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class DocumentsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Listar documentos generados',
    description: 'Todas las versiones, más nuevas primero.',
  })
  @ApiPaginatedResponse(GeneratedDocumentDto, 'Documentos generados')
  async list(
    @Query() query: ListDocumentsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<GeneratedDocumentView>>> {
    const result = await this.queryBus.execute<
      ListDocumentsQuery,
      PaginatedResult<GeneratedDocumentView>
    >(
      new ListDocumentsQuery(
        {
          kind: query.kind,
          entityId: query.entityId,
          status: query.status as DocumentStatus | undefined,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get(':kind/:entityId')
  @Roles(Role.ADMIN, Role.EMPLOYEE, Role.OWNER, Role.RENTER)
  @ApiOperation({
    summary: 'Documento vigente de una entidad',
    description:
      'El PDF vigente (`READY`) de la liquidación, el consolidado, el pago o el contrato. 200 si está listo; 202 con `status: PENDING` si todavía se está generando (volver a consultar); 200 con `FAILED` si el último intento falló. 404 `DOCUMENT_NOT_FOUND` si nunca se pidió o no es del usuario (portales).',
  })
  @ApiParam({ name: 'kind', enum: DocumentKind, enumName: 'DocumentKind' })
  @ApiResponse({ status: 200, type: GeneratedDocumentDto })
  @ApiResponse({ status: 202, type: GeneratedDocumentDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async get(
    @Param('kind', KIND_PIPE) kind: DocumentKind,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ): Promise<ApiSuccessDto<GeneratedDocumentView>> {
    const document = await this.queryBus.execute<
      GetDocumentQuery,
      GeneratedDocumentView
    >(new GetDocumentQuery(kind, entityId, { id: user.id, role: user.role }))
    if (document.status === DocumentStatus.PENDING) {
      response.status(HttpStatus.ACCEPTED)
    }
    return { success: true, message: null, data: document }
  }

  @Post(':kind/:entityId/regenerate')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Regenerar el PDF',
    description:
      'Encola una versión nueva (por ejemplo después de cambiar el logo) y responde 202 con la versión en `PENDING`. La anterior no se pisa.',
  })
  @ApiParam({ name: 'kind', enum: DocumentKind, enumName: 'DocumentKind' })
  @ApiResponse({ status: 202, type: GeneratedDocumentDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async regenerate(
    @Param('kind', KIND_PIPE) kind: DocumentKind,
    @Param('entityId', ParseUUIDPipe) entityId: string,
    @CurrentUser('id') userId: string,
  ): Promise<ApiSuccessDto<GeneratedDocumentView>> {
    const document = await this.commandBus.execute<
      RegenerateDocumentCommand,
      GeneratedDocumentView
    >(new RegenerateDocumentCommand(kind, entityId, userId))
    return {
      success: true,
      message: 'Generando el documento',
      data: document,
    }
  }
}
