import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'

import { Configuration } from '@/shared/config/configuration'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import { SiteRevalidationPort } from '../../domain/site.ports'

const TIMEOUT_MS = 3_000

/**
 * Le avisa a `apps/sites` (`POST <url>/api/revalidate`, con el secreto
 * compartido) que el sitio de un slug cambió. Sin URL y secreto configurados no
 * hace nada. Nunca falla: publicar no puede depender de que la otra app esté
 * arriba; en el peor caso el sitio se actualiza al vencer su caché.
 */
@Injectable()
export class HttpSiteRevalidation extends SiteRevalidationPort {
  private readonly logger = createLogger('SiteRevalidation')

  constructor(private readonly config: ConfigService<Configuration, true>) {
    super()
  }

  async revalidate(slug: string): Promise<void> {
    const target = this.config.get('sites', { infer: true }).revalidate
    if (!target) return
    try {
      const response = await fetch(`${target.url}/api/revalidate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${target.secret}`,
        },
        body: JSON.stringify({ slug }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!response.ok) {
        this.logger.warn(
          { slug, status: response.status },
          'La app de sitios rechazó el aviso',
        )
      }
    } catch (error) {
      this.logger.warn(
        { slug, err: errorMessage(error) },
        'No se pudo avisar a la app de sitios',
      )
    }
  }
}
