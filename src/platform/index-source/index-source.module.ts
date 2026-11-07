import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { IndexSourceProvider } from '@/shared/config/env.validation'
import { BcraIndecIndexSource } from './adapters/bcra-indec.index-source'
import { ManualIndexSource } from './adapters/manual.index-source'
import { IndexSourcePort } from './index-source.port'

/**
 * Registra el `IndexSourcePort` según `INDEX_SOURCE_PROVIDER` (default:
 * `bcra-indec`). Ninguna de las dos fuentes necesita credenciales.
 */
@Global()
@Module({
  providers: [
    {
      provide: IndexSourcePort,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Configuration, true>,
      ): IndexSourcePort =>
        config.get('automations', { infer: true }).indexSource ===
        IndexSourceProvider.Manual
          ? new ManualIndexSource()
          : new BcraIndecIndexSource(),
    },
  ],
  exports: [IndexSourcePort],
})
export class IndexSourceModule {}
