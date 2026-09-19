import { DefaultFlag, Flagsmith } from 'flagsmith-nodejs'

import { RequestContext } from '@/shared/context/request-context'
import { createLogger } from '@/shared/logging/root-logger'
import { FeatureFlagContext, FeatureFlagPort } from '../feature-flag.port'

/** Trait por el que se arman los segmentos por inmobiliaria en Flagsmith. */
export const TENANT_TRAIT = 'tenant_id'

/**
 * `FeatureFlagPort` sobre Flagsmith. Es el único archivo que importa su SDK.
 *
 * Cada tenant es una *identity* de Flagsmith (`tenant_<id>`) con el trait
 * `tenant_id`. Para prender un flag sólo para una inmobiliaria, se crea en
 * Flagsmith un segmento `tenant_id = <id>` y un override del flag para ese
 * segmento; no hace falta lógica propia.
 */
export class FlagsmithFeatureFlagAdapter extends FeatureFlagPort {
  private readonly logger = createLogger('FeatureFlags')
  private readonly client: Flagsmith

  constructor(environmentKey: string) {
    super()
    this.client = new Flagsmith({
      environmentKey,
      requestTimeoutSeconds: 3,
      // Flag desconocido o Flagsmith caído: apagado.
      defaultFlagHandler: () => new DefaultFlag(null, false),
    })
  }

  async isEnabled(
    flagKey: string,
    context?: FeatureFlagContext,
  ): Promise<boolean> {
    const tenantId = context?.tenantId ?? RequestContext.tenantId

    try {
      const flags = tenantId
        ? await this.client.getIdentityFlags(`tenant_${tenantId}`, {
            [TENANT_TRAIT]: tenantId,
          })
        : await this.client.getEnvironmentFlags()

      return flags.isFeatureEnabled(flagKey)
    } catch (error) {
      this.logger.warn(
        { err: error, flagKey, tenantId },
        'No se pudo consultar Flagsmith: el flag se considera apagado',
      )
      return false
    }
  }

  close(): Promise<void> {
    return this.client.close()
  }
}
