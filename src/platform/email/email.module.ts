import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { EmailProvider } from '@/shared/config/env.validation'
import { ConsoleEmailAdapter } from './adapters/console.email-adapter'
import { ResendEmailAdapter } from './adapters/resend.email-adapter'
import { EmailPort } from './email.port'

/**
 * Registra el `EmailPort` según `EMAIL_PROVIDER`: consola (default) o Resend.
 * Con `resend`, la validación de entorno ya exigió `RESEND_API_KEY` y
 * `EMAIL_FROM`.
 */
@Global()
@Module({
  providers: [
    {
      provide: EmailPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>): EmailPort => {
        const email = config.get('email', { infer: true })
        if (email.provider === EmailProvider.Resend && email.resendApiKey) {
          return new ResendEmailAdapter(email.resendApiKey, email.from)
        }
        return new ConsoleEmailAdapter()
      },
    },
  ],
  exports: [EmailPort],
})
export class EmailModule {}
