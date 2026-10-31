import { Global, Module } from '@nestjs/common'

import { PdfmakePdfAdapter } from './adapters/pdfmake.pdf-adapter'
import { PdfRendererPort } from './pdf.port'

/**
 * Registra el `PdfRendererPort`. `PDF_PROVIDER` sólo admite `pdfmake` hoy;
 * un adapter Chromium (A-31) se suma con su `case` acá, leyendo `pdf.provider`
 * de la config.
 */
@Global()
@Module({
  providers: [
    {
      provide: PdfRendererPort,
      useFactory: (): PdfRendererPort => new PdfmakePdfAdapter(),
    },
  ],
  exports: [PdfRendererPort],
})
export class PdfModule {}
