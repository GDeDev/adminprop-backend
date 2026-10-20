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
  ApplyRentUpdateCommand,
  CreateContractCommand,
  RenewContractCommand,
  TerminateContractCommand,
  UpdateContractCommand,
  UploadContractDocumentCommand,
} from '@/modules/contracts/application/commands/contract.commands'
import {
  MAX_DOCUMENT_BYTES,
  TerminationResult,
} from '@/modules/contracts/application/commands/contract.handlers'
import {
  ContractDetailView,
  ContractSummaryView,
} from '@/modules/contracts/application/contract.views'
import {
  GetContractQuery,
  ListContractsQuery,
  PreviewTerminationQuery,
} from '@/modules/contracts/application/queries/contract.queries'
import { TerminationBreakdown } from '@/modules/contracts/domain/contract.policy'
import {
  ContractDocumentKind,
  SuretyData,
} from '@/modules/contracts/domain/contract.ports'
import { ApiErrorDto, ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PaginatedResult } from '@/shared/pagination'
import { ApiPaginatedResponse } from '@/shared/pagination/api-paginated-response.decorator'
import {
  ApplyRentUpdateDto,
  ContractDetailDto,
  ContractSummaryDto,
  CreateContractDto,
  ListContractsQueryDto,
  PartialSuretyDto,
  RenewContractDto,
  TerminateContractDto,
  TerminationPreviewDto,
  TerminationPreviewQueryDto,
  TerminationResultDto,
  UpdateContractDto,
} from '../dtos/contract.dtos'

function toSurety(dto: {
  hasSurety: boolean
  insurerName?: string | null
  insurerAlertEmail?: string | null
  policyNumber?: string | null
  policyExpiresAt?: string | null
}): SuretyData {
  return {
    hasSurety: dto.hasSurety,
    insurerName: dto.insurerName ?? null,
    insurerAlertEmail: dto.insurerAlertEmail ?? null,
    policyNumber: dto.policyNumber ?? null,
    policyExpiresAt: dto.policyExpiresAt ?? null,
  }
}

/** Sólo lo que vino: la mezcla con lo actual la hace el handler. */
function toPartialSurety(dto: PartialSuretyDto): Partial<SuretyData> {
  const result: Partial<SuretyData> = {}
  if (dto.hasSurety !== undefined) result.hasSurety = dto.hasSurety
  if (dto.insurerName !== undefined) result.insurerName = dto.insurerName
  if (dto.insurerAlertEmail !== undefined)
    result.insurerAlertEmail = dto.insurerAlertEmail
  if (dto.policyNumber !== undefined) result.policyNumber = dto.policyNumber
  if (dto.policyExpiresAt !== undefined)
    result.policyExpiresAt = dto.policyExpiresAt
  return result
}

const DOCUMENT_BODY = {
  schema: {
    type: 'object',
    properties: { file: { type: 'string', format: 'binary' } },
  },
}

/**
 * Contratos (spec Fase 9). Admin y empleado operan todo; no hay borrado: un
 * contrato finalizado o rescindido es historial.
 */
@ApiTags('Contracts')
@ApiBearerAuth()
@Roles(Role.ADMIN, Role.EMPLOYEE)
@Controller({ path: 'contracts' })
@ApiResponse({
  status: 403,
  description: 'Rol insuficiente',
  type: ApiErrorDto,
})
export class ContractsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Listar, con filtros por estado, propiedad, inquilino, propietario y vencimiento',
    description:
      'Cada fila trae las partes, el alquiler vigente y las marcas calculadas: por vencer, vencido, póliza vencida.',
  })
  @ApiPaginatedResponse(ContractSummaryDto, 'Contratos de la inmobiliaria')
  async list(
    @Query() query: ListContractsQueryDto,
  ): Promise<ApiSuccessDto<PaginatedResult<ContractSummaryView>>> {
    const result = await this.queryBus.execute<
      ListContractsQuery,
      PaginatedResult<ContractSummaryView>
    >(
      new ListContractsQuery(
        {
          status: query.status,
          propertyId: query.propertyId,
          renterId: query.renterId,
          ownerId: query.ownerId,
          expiringSoon: query.expiringSoon,
        },
        { page: query.page, limit: query.limit },
      ),
    )
    return { success: true, message: null, data: result }
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Ficha completa',
    description:
      'Con el historial del alquiler, la línea de tiempo y la caución. `monthlyStatus` llega con la Fase 11.',
  })
  @ApiResponse({ status: 200, type: ContractDetailDto })
  @ApiResponse({ status: 404, type: ApiErrorDto })
  async findOne(
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    const contract = await this.queryBus.execute<
      GetContractQuery,
      ContractDetailView
    >(new GetContractQuery(id))
    return { success: true, message: null, data: contract }
  }

  @Get(':id/termination-preview')
  @ApiOperation({
    summary: 'Desglose de la multa por rescisión, sin rescindir',
    description:
      'Mismas reglas y misma cuenta que POST /contracts/:id/terminate.',
  })
  @ApiResponse({ status: 200, type: TerminationPreviewDto })
  @ApiResponse({
    status: 400,
    description: 'Fecha de notificación fuera del contrato',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'El contrato no está activo',
    type: ApiErrorDto,
  })
  async terminationPreview(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() query: TerminationPreviewQueryDto,
  ): Promise<ApiSuccessDto<TerminationBreakdown>> {
    const preview = await this.queryBus.execute<
      PreviewTerminationQuery,
      TerminationBreakdown
    >(new PreviewTerminationQuery(id, query.notifiedAt))
    return { success: true, message: null, data: preview }
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Alta',
    description:
      'El propietario sale de la propiedad y los honorarios se fijan con su estado en este momento. La propiedad pasa a alquilada.',
  })
  @ApiResponse({ status: 201, type: ContractDetailDto })
  @ApiResponse({
    status: 400,
    description: 'Fechas inválidas, o caución sin email de alerta',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'La propiedad ya tiene un contrato activo, o el inquilino ya es titular de otro',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description:
      'Propiedad, inquilino o garante inexistente, o propiedad sin propietario',
    type: ApiErrorDto,
  })
  async create(
    @Body() dto: CreateContractDto,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    const contract = await this.commandBus.execute<
      CreateContractCommand,
      ContractDetailView
    >(
      new CreateContractCommand(dto.propertyId, dto.renterId, dto.guarantorId, {
        startDate: dto.startDate,
        endDate: dto.endDate,
        initialRent: dto.initialRent,
        currency: dto.currency,
        rentUpdateType: dto.rentUpdateType,
        rentUpdateFrequency: dto.rentUpdateFrequency,
        deposit: dto.deposit,
        notes: dto.notes ?? null,
        surety: toSurety(dto),
      }),
    )
    return { success: true, message: 'Contrato creado', data: contract }
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Editar notas, caución o garante',
    description:
      'Fechas, montos, partes y estado no se editan: cambian por un aumento, una rescisión o una renovación.',
  })
  @ApiResponse({ status: 200, type: ContractDetailDto })
  @ApiResponse({ status: 400, type: ApiErrorDto })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateContractDto,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    const contract = await this.commandBus.execute<
      UpdateContractCommand,
      ContractDetailView
    >(
      new UpdateContractCommand(id, {
        notes: dto.notes,
        guarantorId: dto.guarantorId,
        surety: dto.surety ? toPartialSurety(dto.surety) : undefined,
      }),
    )
    return { success: true, message: 'Contrato actualizado', data: contract }
  }

  @Post(':id/documents/contract')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }),
  )
  @ApiOperation({
    summary: 'Subir el PDF del contrato firmado (reemplaza al anterior)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(DOCUMENT_BODY)
  @ApiResponse({ status: 201, type: ContractDetailDto })
  @ApiResponse({
    status: 400,
    description: 'No es un PDF o pesa más de 10 MB',
    type: ApiErrorDto,
  })
  uploadContractPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    return this.uploadDocument(id, 'contract', file)
  }

  @Post(':id/documents/policy')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_DOCUMENT_BYTES } }),
  )
  @ApiOperation({
    summary: 'Subir el PDF de la póliza de caución (reemplaza al anterior)',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody(DOCUMENT_BODY)
  @ApiResponse({ status: 201, type: ContractDetailDto })
  @ApiResponse({
    status: 400,
    description: 'No es un PDF o pesa más de 10 MB',
    type: ApiErrorDto,
  })
  uploadPolicyPdf(
    @Param('id', new ParseUUIDPipe()) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    return this.uploadDocument(id, 'policy', file)
  }

  @Post(':id/rent-updates')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Aplicar el próximo aumento programado',
    description:
      'Con ICL/IPC el nuevo alquiler sale de la variación del índice entre el mes del aumento anterior y el del nuevo. Con FIXED/OTHER, `newRent` es obligatorio. Aplica un aumento por llamada.',
  })
  @ApiResponse({ status: 201, type: ContractDetailDto })
  @ApiResponse({
    status: 400,
    description: 'Falta `newRent` en un contrato FIXED/OTHER',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'Todavía no corresponde, no quedan aumentos, o el contrato no está activo',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 422,
    description: 'Falta el valor del índice de algún período',
    type: ApiErrorDto,
  })
  async applyRentUpdate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: ApplyRentUpdateDto,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    const contract = await this.commandBus.execute<
      ApplyRentUpdateCommand,
      ContractDetailView
    >(new ApplyRentUpdateCommand(id, dto.newRent))
    return { success: true, message: 'Aumento aplicado', data: contract }
  }

  @Post(':id/terminate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Rescindir anticipadamente',
    description:
      'Calcula y guarda la multa (10 % del canon futuro, RN-09); la propiedad vuelve a disponible.',
  })
  @ApiResponse({ status: 200, type: TerminationResultDto })
  @ApiResponse({
    status: 400,
    description: 'Fecha de notificación fuera del contrato',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: 'El contrato no está activo',
    type: ApiErrorDto,
  })
  async terminate(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: TerminateContractDto,
  ): Promise<ApiSuccessDto<TerminationResult>> {
    const result = await this.commandBus.execute<
      TerminateContractCommand,
      TerminationResult
    >(new TerminateContractCommand(id, dto.notifiedAt))
    return { success: true, message: 'Contrato rescindido', data: result }
  }

  @Post(':id/renew')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Renovar',
    description:
      'Crea un contrato nuevo, activo, precargado con el original salvo lo que se indique (el inquilino puede cambiar); el original queda finalizado.',
  })
  @ApiResponse({ status: 201, type: ContractDetailDto })
  @ApiResponse({
    status: 400,
    description: 'Fechas inválidas o inicio anterior al original',
    type: ApiErrorDto,
  })
  @ApiResponse({
    status: 409,
    description:
      'El original no está activo, o el inquilino nuevo ya tiene contrato',
    type: ApiErrorDto,
  })
  @ApiResponse({ status: 422, type: ApiErrorDto })
  async renew(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RenewContractDto,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    const suretyGiven =
      dto.hasSurety !== undefined ||
      dto.insurerName !== undefined ||
      dto.insurerAlertEmail !== undefined ||
      dto.policyNumber !== undefined ||
      dto.policyExpiresAt !== undefined
    const contract = await this.commandBus.execute<
      RenewContractCommand,
      ContractDetailView
    >(
      new RenewContractCommand(id, dto.startDate, dto.endDate, {
        renterId: dto.renterId,
        guarantorId: dto.guarantorId,
        initialRent: dto.initialRent,
        currency: dto.currency,
        rentUpdateType: dto.rentUpdateType,
        rentUpdateFrequency: dto.rentUpdateFrequency,
        deposit: dto.deposit,
        notes: dto.notes,
        surety: suretyGiven ? toPartialSurety(dto) : undefined,
      }),
    )
    return { success: true, message: 'Contrato renovado', data: contract }
  }

  private async uploadDocument(
    id: string,
    kind: ContractDocumentKind,
    file: Express.Multer.File | undefined,
  ): Promise<ApiSuccessDto<ContractDetailView>> {
    // Sin archivo el handler responde con su propio 400: no hace falta un
    // ParseFilePipe que daría un código genérico.
    const contract = await this.commandBus.execute<
      UploadContractDocumentCommand,
      ContractDetailView
    >(
      new UploadContractDocumentCommand(
        id,
        kind,
        file?.buffer ?? Buffer.alloc(0),
        file?.mimetype ?? '',
      ),
    )
    return {
      success: true,
      message: kind === 'contract' ? 'Contrato adjuntado' : 'Póliza adjuntada',
      data: contract,
    }
  }
}
