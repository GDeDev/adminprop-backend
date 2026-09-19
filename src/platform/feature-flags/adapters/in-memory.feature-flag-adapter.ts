import { RequestContext } from '@/shared/context/request-context'
import { FeatureFlagContext, FeatureFlagPort } from '../feature-flag.port'

/**
 * `FeatureFlagPort` en memoria (`FEATURE_FLAGS_PROVIDER=memory`), para tests y
 * para desarrollar sin cuenta de Flagsmith.
 *
 * Los flags de `FEATURE_FLAGS_ENABLED` arrancan prendidos para todos los
 * tenants. Los tests pueden prender un flag sólo para un tenant con `enable`.
 */
export class InMemoryFeatureFlagAdapter extends FeatureFlagPort {
  private readonly global = new Set<string>()
  private readonly perTenant = new Map<string, Set<string>>()

  constructor(enabledFlags: string[] = []) {
    super()
    enabledFlags.forEach((flag) => this.global.add(flag))
  }

  async isEnabled(
    flagKey: string,
    context?: FeatureFlagContext,
  ): Promise<boolean> {
    if (this.global.has(flagKey)) return true
    const tenantId = context?.tenantId ?? RequestContext.tenantId
    return tenantId ? !!this.perTenant.get(flagKey)?.has(tenantId) : false
  }

  /** Prende el flag para todos o, con `tenantId`, sólo para ese tenant. */
  enable(flagKey: string, tenantId?: string): void {
    if (!tenantId) {
      this.global.add(flagKey)
      return
    }
    const tenants = this.perTenant.get(flagKey) ?? new Set<string>()
    tenants.add(tenantId)
    this.perTenant.set(flagKey, tenants)
  }

  disable(flagKey: string): void {
    this.global.delete(flagKey)
    this.perTenant.delete(flagKey)
  }
}
