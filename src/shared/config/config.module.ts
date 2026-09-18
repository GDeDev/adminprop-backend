import { Global, Module } from '@nestjs/common'
import { ConfigModule, ConfigService } from '@nestjs/config'

import { configuration, Configuration } from './configuration'
import { validateEnv } from './env.validation'

/**
 * `ConfigService` con tipos: `config.get('jwt', { infer: true })` devuelve
 * `JwtConfig` en vez de `any`.
 */
export type TypedConfigService = ConfigService<Configuration, true>

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
      load: [configuration],
    }),
  ],
  exports: [ConfigModule],
})
export class AppConfigModule {}
