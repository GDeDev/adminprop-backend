import { Global, Module } from '@nestjs/common'

import { ConsoleEmailAdapter } from './adapters/console.email-adapter'
import { EmailPort } from './email.port'

/**
 * Registra el `EmailPort`. Hoy `EMAIL_PROVIDER` sólo admite `console`; el
 * adapter de Resend (vía Novu) se suma en la Fase 14 con su `case` acá.
 */
@Global()
@Module({
  providers: [
    { provide: EmailPort, useFactory: () => new ConsoleEmailAdapter() },
  ],
  exports: [EmailPort],
})
export class EmailModule {}
