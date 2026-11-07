import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
} from '@nestjs/common'
import { ApiOperation, ApiTags } from '@nestjs/swagger'
import type { Request } from 'express'

import { IsPublic } from '@/modules/auth/public'
import { ResendWebhookService } from '../../../application/resend-webhook.service'
import { ApiSuccessDto } from '@/shared/dtos/api-response.dto'

/**
 * Webhooks de proveedores (sin JWT: la autenticidad la da la firma). La API
 * documentada es la de Resend; el cuerpo crudo lo deja `configureApp` en
 * `request.rawBody` para poder verificar la firma byte a byte.
 */
@ApiTags('Webhooks')
@IsPublic()
@Controller({ path: 'webhooks' })
export class WebhooksController {
  constructor(private readonly resend: ResendWebhookService) {}

  @Post('resend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook de Resend',
    description:
      'Público, con firma Svix (`svix-id`, `svix-timestamp`, `svix-signature`) y tolerancia de 5 minutos. Firma inválida: 401. Un evento repetido o de un mensaje desconocido responde 200 sin duplicar nada.',
  })
  async resendEvent(
    @Req() request: Request & { rawBody?: Buffer },
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
  ): Promise<ApiSuccessDto<{ recorded: boolean }>> {
    const result = await this.resend.handle(request.rawBody, {
      id,
      timestamp,
      signature,
    })
    return { success: true, message: null, data: result }
  }
}
