import { Global, Inject, Module, OnApplicationShutdown } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { FeatureFlagsProvider } from '@/shared/config/env.validation'
import { FlagsmithFeatureFlagAdapter } from './adapters/flagsmith.feature-flag-adapter'
import { InMemoryFeatureFlagAdapter } from './adapters/in-memory.feature-flag-adapter'
import { FeatureFlagPort } from './feature-flag.port'

/** Registra el `FeatureFlagPort` según `FEATURE_FLAGS_PROVIDER`. */
@Global()
@Module({
  providers: [
    {
      provide: FeatureFlagPort,
      inject: [ConfigService],
      useFactory: (
        config: ConfigService<Configuration, true>,
      ): FeatureFlagPort => {
        const flags = config.get('featureFlags', { infer: true })

        if (flags.provider === FeatureFlagsProvider.Flagsmith) {
          // env.validation ya exige la key con este proveedor; el chequeo sólo
          // convence al compilador.
          if (!flags.flagsmithEnvironmentKey) {
            throw new Error('Falta FLAGSMITH_ENVIRONMENT_KEY')
          }
          return new FlagsmithFeatureFlagAdapter(flags.flagsmithEnvironmentKey)
        }

        return new InMemoryFeatureFlagAdapter(flags.enabled)
      },
    },
  ],
  exports: [FeatureFlagPort],
})
export class FeatureFlagsModule implements OnApplicationShutdown {
  constructor(
    @Inject(FeatureFlagPort) private readonly flags: FeatureFlagPort,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.flags instanceof FlagsmithFeatureFlagAdapter) {
      await this.flags.close()
    }
  }
}
