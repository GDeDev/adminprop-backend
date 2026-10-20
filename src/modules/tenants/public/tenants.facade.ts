import { Injectable } from '@nestjs/common'

import { TenantRepository } from '../domain/tenant.repository'

/** Parámetros de la inmobiliaria que gobiernan los contratos (PRD 5.0). */
export interface TenantContractSettings {
  /** En %, como string decimal ("5.00"). */
  standardFeePercentage: string
  reducedFeePercentage: string
  reducedFeeThreshold: number
  contractExpiryNoticeDays: number
}

/**
 * Punto de entrada sincrónico a `tenants` desde otros módulos. Expone lo
 * mínimo: el día que las inmobiliarias vivan en otro servicio, esta clase pasa
 * a ser un cliente HTTP con la misma firma.
 */
@Injectable()
export class TenantsFacade {
  constructor(private readonly tenants: TenantRepository) {}

  /**
   * Id de la inmobiliaria habilitada con ese slug, o `null` si no existe o
   * está deshabilitada. La usa el login de portal.
   */
  async findActiveIdBySlug(slug: string): Promise<string | null> {
    const tenant = await this.tenants.findBySlug(slug)
    return tenant?.isActive ? tenant.id : null
  }

  /**
   * Desde cuántas propiedades activas aplica el honorario reducido (PRD 5.0,
   * RN-07). Cada inmobiliaria define el suyo; por defecto, 3.
   */
  async getReducedFeeThreshold(tenantId: string): Promise<number> {
    return (await this.getContractSettings(tenantId)).reducedFeeThreshold
  }

  /** Honorarios, umbral y días de aviso de vencimiento de la inmobiliaria. */
  async getContractSettings(tenantId: string): Promise<TenantContractSettings> {
    const tenant = await this.tenants.findById(tenantId)
    if (!tenant) throw new Error(`Tenant inexistente: ${tenantId}`)
    return {
      standardFeePercentage: tenant.standardFeePercentage,
      reducedFeePercentage: tenant.reducedFeePercentage,
      reducedFeeThreshold: tenant.reducedFeeThreshold,
      contractExpiryNoticeDays: tenant.contractExpiryNoticeDays,
    }
  }
}
