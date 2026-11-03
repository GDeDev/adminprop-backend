import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
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
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import { UpdatePublicInquiryStatusCommand } from '../../../application/public.commands'
import { ListPublicInquiriesQuery } from '../../../application/public.queries'
import { PublicInquiryView } from '../../../application/public.views'
import {
  ListInquiriesQueryDto,
  PublicInquiryDto,
  UpdateInquiryStatusDto,
} from '../dtos/public.dtos'

/**
 * Consultas que llegaron por el portal (Fase 22). Admin y empleado las ven y
 * cambian su estado; el CRM de la Fase 23 las consume.
 */
@ApiTags('Inquiries')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'inquiries' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class InquiriesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Listar las consultas del portal' })
  @ApiPaginatedResponse(PublicInquiryDto, 'Consultas, más nuevas primero')
  async list(
    @Query() query: ListInquiriesQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<PublicInquiryView>>> {
    const result = await this.queryBus.execute<
      ListPublicInquiriesQuery,
      PaginatedResult<PublicInquiryView>
    >(
      new ListPublicInquiriesQuery(
        { status: query.status, propertyId: query.propertyId },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Cambiar el estado de una consulta' })
  @ApiResponse({ status: 200, type: PublicInquiryDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async updateStatus(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateInquiryStatusDto,
  ): Promise<ApiSuccessDto<PublicInquiryView>> {
    const inquiry = await this.commandBus.execute<
      UpdatePublicInquiryStatusCommand,
      PublicInquiryView
    >(new UpdatePublicInquiryStatusCommand(id, dto.status))
    return { success: true, message: 'Estado actualizado', data: inquiry }
  }
}
