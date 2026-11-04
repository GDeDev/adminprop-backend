import { Injectable } from '@nestjs/common'

import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { SiteRevalidationPort } from '../domain/site.ports'
import { SiteDraftService } from './site-draft.service'

/**
 * Avisa a `apps/sites` que el sitio de la inmobiliaria del contexto cambió.
 *
 * **No se espera**: el aviso es una llamada HTTP de hasta 3 s a otra app, y el
 * administrador que apretó "Publicar" no tiene por qué esperarla (ni fallar si
 * la otra app está caída). Se dispara y, si falla, se loguea; el sitio se
 * actualiza igual cuando vence su caché. El slug se resuelve ANTES de soltar la
 * promesa, mientras el contexto de la request sigue vivo.
 */
@Injectable()
export class SiteChangeNotifier {
  private readonly logger = createLogger('SiteChangeNotifier')

  constructor(
    private readonly revalidation: SiteRevalidationPort,
    private readonly drafts: SiteDraftService,
  ) {}

  async notify(): Promise<void> {
    const { slug } = await this.drafts.tenantData()
    this.fire(slug)
  }

  private fire(slug: string): void {
    // `Promise.resolve().then` también captura una excepción síncrona del puerto.
    void Promise.resolve()
      .then(() => this.revalidation.revalidate(slug))
      .catch((error: unknown) =>
        this.logger.warn(
          { slug, err: errorMessage(error) },
          'No se pudo avisar a la app de sitios',
        ),
      )
  }
}
