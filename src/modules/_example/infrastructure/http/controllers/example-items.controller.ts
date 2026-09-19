import {
  Body,
  Controller,
  FileTypeValidator,
  Get,
  HttpCode,
  HttpStatus,
  MaxFileSizeValidator,
  Param,
  ParseFilePipe,
  ParseUUIDPipe,
  Post,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger'

import { AttachExampleFileCommand } from '@/modules/_example/application/commands/attach-example-file/attach-example-file.command'
import { CreateExampleItemCommand } from '@/modules/_example/application/commands/create-example-item/create-example-item.command'
import { RecalculateExamplePricesCommand } from '@/modules/_example/application/commands/recalculate-example-prices/recalculate-example-prices.command'
import { ExampleItemView } from '@/modules/_example/application/example-item.view'
import { GetExampleItemQuery } from '@/modules/_example/application/queries/get-example-item/get-example-item.query'
import { Role, Roles } from '@/modules/auth/public'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  CreateExampleItemDto,
  ExampleItemDto,
  JobAcceptedDto,
  RecalculateExamplePricesDto,
} from '../dtos/example-item.dtos'

/** 5 MB: suficiente para una foto o un PDF, y frena abusos. */
const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024

/**
 * Controller del módulo de referencia. Sin lógica de negocio: recibe el DTO ya
 * validado, arma el Command/Query, lo despacha y envuelve la respuesta. Así
 * se ve cualquier controller del proyecto.
 *
 * Protegido por el `JwtAuthGuard` global (no hace falta decorar nada) y
 * restringido al backoffice con `@Roles`.
 */
@ApiTags('Example (módulo de referencia)')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'examples' })
export class ExampleItemsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Crear un ítem' })
  @ApiResponse({ status: 201, type: ExampleItemDto })
  @ApiResponse({
    status: 409,
    description: 'Nombre repetido',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Precio no positivo',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateExampleItemDto,
  ): Promise<ApiSuccessDto<ExampleItemView>> {
    const item = await this.commandBus.execute<
      CreateExampleItemCommand,
      ExampleItemView
    >(new CreateExampleItemCommand(dto.name, dto.price))

    return { success: true, message: 'Ítem creado', data: item }
  }

  @Get(':id')
  @ApiOperation({ summary: 'Ver un ítem' })
  @ApiResponse({ status: 200, type: ExampleItemDto })
  @ApiResponse({
    status: 404,
    description: 'No existe, o es de otra inmobiliaria',
    type: ApiErrorDto,
  })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<ExampleItemView>> {
    const item = await this.queryBus.execute<
      GetExampleItemQuery,
      ExampleItemView
    >(new GetExampleItemQuery(id))

    return { success: true, message: null, data: item }
  }

  @Post(':id/attachment')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_ATTACHMENT_BYTES } }),
  )
  @ApiOperation({ summary: 'Adjuntar un archivo (imagen o PDF, hasta 5 MB)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiResponse({ status: 201, type: ExampleItemDto })
  async attach(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile(
      new ParseFilePipe({
        validators: [
          new MaxFileSizeValidator({ maxSize: MAX_ATTACHMENT_BYTES }),
          new FileTypeValidator({
            fileType: /^(image\/(jpeg|png|webp)|application\/pdf)$/,
          }),
        ],
      }),
    )
    file: Express.Multer.File,
  ): Promise<ApiSuccessDto<ExampleItemView>> {
    const item = await this.commandBus.execute<
      AttachExampleFileCommand,
      ExampleItemView
    >(
      new AttachExampleFileCommand(
        id,
        file.buffer,
        file.originalname,
        file.mimetype,
      ),
    )

    return { success: true, message: 'Adjunto guardado', data: item }
  }

  @Post('recalculate')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Aumentar el precio de todos los ítems (en background)',
    description:
      'Responde 202 con un jobId. El avance se consulta en GET /api/v1/jobs/{jobId}/status. ' +
      'Requiere el feature flag "example-bulk-recalculate" para el tenant.',
  })
  @ApiResponse({ status: 202, type: JobAcceptedDto })
  @ApiResponse({
    status: 403,
    description: 'Flag apagado para el tenant (FEATURE_DISABLED)',
    type: ApiErrorDto,
  })
  async recalculate(
    @Body() dto: RecalculateExamplePricesDto,
  ): Promise<ApiSuccessDto<{ jobId: string }>> {
    const accepted = await this.commandBus.execute<
      RecalculateExamplePricesCommand,
      { jobId: string }
    >(
      new RecalculateExamplePricesCommand(
        dto.percentage,
        dto.simulateTransientFailure ?? false,
      ),
    )

    return { success: true, message: 'Aumento encolado', data: accepted }
  }
}
