import { Global, Module } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { TokkoSourceProvider } from '@/shared/config/env.validation'
import { FixtureImageDownloader } from './adapters/fixture-image-downloader'
import { HttpImageDownloader } from './adapters/http-image-downloader'
import { TokkoFixtureSource } from './adapters/tokko-fixture.source'
import { TokkoHttpSource } from './adapters/tokko-http.source'
import { ImageDownloaderPort } from './image-downloader.port'
import { TokkoSourcePort } from './tokko-source.port'

/**
 * Registra la fuente de Tokko y el descargador de fotos según `TOKKO_SOURCE`
 * (default: `fixture`). Con `http` la key sale de `TOKKO_API_KEY`; si falta, el
 * análisis falla con un mensaje claro en vez de impedir el arranque.
 */
@Global()
@Module({
  providers: [
    {
      provide: TokkoSourcePort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) => {
        const { source, apiKey } = config.get('tokko', { infer: true })
        return source === TokkoSourceProvider.Http
          ? new TokkoHttpSource(apiKey)
          : new TokkoFixtureSource()
      },
    },
    {
      provide: ImageDownloaderPort,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Configuration, true>) =>
        config.get('tokko', { infer: true }).source === TokkoSourceProvider.Http
          ? new HttpImageDownloader()
          : new FixtureImageDownloader(),
    },
  ],
  exports: [TokkoSourcePort, ImageDownloaderPort],
})
export class TokkoModule {}
