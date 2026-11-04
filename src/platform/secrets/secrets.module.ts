import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { AesGcmSecretBox } from './adapters/aes-gcm.secret-box'
import { SecretBoxPort } from './secret-box.port'

/**
 * Registra el `SecretBoxPort` con `APP_ENCRYPTION_KEY`. Sin clave el módulo
 * arranca igual (la clave vive en Doppler y es opcional en desarrollo); el
 * error aparece recién al guardar o leer un secreto.
 */
@Global()
@Module({
  providers: [
    {
      provide: SecretBoxPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) =>
        new AesGcmSecretBox(
          config.get('security', { infer: true }).encryptionKey,
        ),
    },
  ],
  exports: [SecretBoxPort],
})
export class SecretsModule {}
