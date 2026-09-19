import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { StorageProvider } from '@/shared/config/env.validation'
import { CloudinaryStorageAdapter } from './adapters/cloudinary.storage-adapter'
import { LocalStorageAdapter } from './adapters/local.storage-adapter'
import { StoragePort } from './storage.port'

/**
 * Registra el `StoragePort` según `STORAGE_PROVIDER`. Cambiar de proveedor
 * (mañana, `s3`) es sumar un adapter y un case acá; ningún módulo de negocio
 * se entera.
 */
@Global()
@Module({
  providers: [
    {
      provide: StoragePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>): StoragePort => {
        const storage = config.get('storage', { infer: true })

        if (storage.provider === StorageProvider.Cloudinary) {
          // env.validation ya exige las credenciales con este proveedor; el
          // chequeo sólo convence al compilador sin un `!`.
          if (!storage.cloudinary) {
            throw new Error('Faltan las credenciales de Cloudinary')
          }
          return new CloudinaryStorageAdapter(storage.cloudinary)
        }

        return new LocalStorageAdapter(
          storage.local.directory,
          storage.local.publicBaseUrl,
        )
      },
    },
  ],
  exports: [StoragePort],
})
export class StorageModule {}
