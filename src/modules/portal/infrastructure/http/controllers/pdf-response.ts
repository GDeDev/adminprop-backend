import { HttpStatus } from '@nestjs/common'
import type { Response } from 'express'

import { ApiSuccessDto } from '@/shared/dtos/api-response.dto'
import { PortalPdfUrlDto } from '../dtos/portal.dtos'

/** 302 al PDF, o `{ url }` si el cliente no puede mandar el token en una navegación. */
export function sendPdf(
  response: Response,
  url: string,
  format: 'json' | undefined,
): void {
  if (format === 'json') {
    const body: ApiSuccessDto<PortalPdfUrlDto> = {
      success: true,
      message: null,
      data: { url },
    }
    response.status(HttpStatus.OK).json(body)
    return
  }
  response.redirect(HttpStatus.FOUND, url)
}
