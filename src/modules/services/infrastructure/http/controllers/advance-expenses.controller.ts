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

import { Role, Roles } from '@/modules/auth/public'
import {
  AdvanceExpenseListView,
  AdvanceExpenseView,
} from '@/modules/services/application/advance-expense.views'
import {
  CreateAdvanceExpenseCommand,
  DeleteAdvanceExpenseCommand,
  UpdateAdvanceExpenseCommand,
} from '@/modules/services/application/commands/advance-expense.commands'
import { ListAdvanceExpensesQuery } from '@/modules/services/application/queries/advance-expense.queries'
import { MAX_RECEIPT_BYTES } from '@/modules/services/domain/advance-expense.policy'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import {
  AdvanceExpenseDto,
  AdvanceExpenseListDto,
  CreateAdvanceExpenseDto,
  ListAdvanceExpensesQueryDto,
  UpdateAdvanceExpenseDto,
} from '../dtos/advance-expense.dtos'

/**
 * Gastos adelantados por el inquilino (spec Fase 10, 3.2; RN-11). Admin y
 * empleado cargan y editan; eliminar es sólo admin. Descontarlos en la
 * liquidación es de la Fase 12: acá sólo se registran.
 */
@ApiTags('Advance expenses')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller()
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class AdvanceExpensesController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get('contracts/:contractId/advance-expenses')
  @ApiOperation({
    summary: 'Gastos adelantados de un contrato',
    description:
      '`settled=true|false` filtra descontados o pendientes. Los totales son del contrato entero, sin importar el filtro.',
  })
  @ApiResponse({ status: 200, type: AdvanceExpenseListDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async list(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Query() query: ListAdvanceExpensesQueryDto,
  ): Promise<ApiSuccessDto<AdvanceExpenseListView>> {
    const result = await this.queryBus.execute<
      ListAdvanceExpensesQuery,
      AdvanceExpenseListView
    >(new ListAdvanceExpensesQuery(contractId, query.settled))
    return { success: true, message: null, data: result }
  }

  @Post('contracts/:contractId/advance-expenses')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_RECEIPT_BYTES } }),
  )
  @ApiOperation({
    summary: 'Registrar un gasto adelantado, con su comprobante',
    description:
      'Multipart: `amount`, `description`, `expenseDate`, `currency?` (la del contrato si no viene) y `file` (JPG, PNG, WebP o PDF, hasta 10 MB, obligatorio). El contrato puede estar en cualquier estado.',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['amount', 'description', 'expenseDate', 'file'],
      properties: {
        amount: { type: 'string', example: '15000.00' },
        description: { type: 'string', maxLength: 300 },
        expenseDate: { type: 'string', format: 'date' },
        currency: { type: 'string', enum: ['ARS', 'USD'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({ status: 201, type: AdvanceExpenseDto })
  @ApiResponse({
    status: 400,
    description:
      'Sin comprobante, comprobante inválido, monto no positivo o fecha inválida',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'El contrato no existe',
    type: ApiErrorDto,
  })
  async create(
    @Param('contractId', new ParseUUIDPipe()) contractId: string,
    @Body() dto: CreateAdvanceExpenseDto,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<AdvanceExpenseView>> {
    // Sin archivo el handler responde con su propio 400: no hace falta un
    // ParseFilePipe que daría un código genérico.
    const expense = await this.commandBus.execute<
      CreateAdvanceExpenseCommand,
      AdvanceExpenseView
    >(
      new CreateAdvanceExpenseCommand(
        contractId,
        {
          amount: dto.amount,
          description: dto.description,
          expenseDate: dto.expenseDate,
          currency: dto.currency ?? null,
        },
        file?.buffer ?? Buffer.alloc(0),
      ),
    )
    return { success: true, message: 'Gasto registrado', data: expense }
  }

  @Patch('advance-expenses/:id')
  @ApiOperation({
    summary: 'Editar un gasto pendiente',
    description:
      'Monto, descripción y fecha. Un gasto ya descontado en una liquidación no se edita (409).',
  })
  @ApiResponse({ status: 200, type: AdvanceExpenseDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya descontado en una liquidación',
    type: ApiErrorDto,
  })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateAdvanceExpenseDto,
  ): Promise<ApiSuccessDto<AdvanceExpenseView>> {
    const expense = await this.commandBus.execute<
      UpdateAdvanceExpenseCommand,
      AdvanceExpenseView
    >(
      new UpdateAdvanceExpenseCommand(id, {
        amount: dto.amount,
        description: dto.description,
        expenseDate: dto.expenseDate,
      }),
    )
    return { success: true, message: 'Gasto actualizado', data: expense }
  }

  @Delete('advance-expenses/:id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Eliminar un gasto pendiente (borrado lógico, sólo admin)',
    description:
      'Un gasto ya descontado en una liquidación no se elimina (409). El comprobante se borra del storage.',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  @ApiResponse({
    status: 409,
    description: 'Ya descontado en una liquidación',
    type: ApiErrorDto,
  })
  async remove(@Param('id', new ParseUUIDPipe()) id: string): Promise<void> {
    await this.commandBus.execute<DeleteAdvanceExpenseCommand, void>(
      new DeleteAdvanceExpenseCommand(id),
    )
  }
}
