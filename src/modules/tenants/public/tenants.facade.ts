import { Injectable } from '@nestjs/common'

import { Tenant } from '../domain/tenant.entity'
import { TenantRepository } from '../domain/tenant.repository'

/** Parámetros de la inmobiliaria que gobiernan los contratos (PRD 5.0). */
export interface TenantContractSettings {
  /** En %, como string decimal ("5.00"). */
  standardFeePercentage: string
  reducedFeePercentage: string
  reducedFeeThreshold: number
  contractExpiryNoticeDays: number
}

/** Parámetros de la inmobiliaria que gobiernan los cobros (PRD 5.0, RN-02). */
export interface TenantBillingSettings {
  /** Días del mes sin punitorio: del 1 al N. */
  paymentGraceDays: number
  /** Punitorio diario, en %, como string decimal ("5.00"). */
  dailyLateFeePercentage: string
  /** Día del mes en que se generan las cuotas del mes siguiente. */
  installmentGenerationDay: number
  /** Día del mes en que sale el recordatorio de pago. */
  paymentReminderDay: number
}

/** Una inmobiliaria habilitada, para recorrerlas desde los jobs. */
export interface ActiveTenantRef {
  id: string
  name: string
  slug: string
}

/** Los días de corte que gobiernan los avisos automáticos (Fase 13). */
export interface TenantAutomationSettings {
  installmentGenerationDay: number
  paymentReminderDay: number
  monthlyReportDay: number
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
    const tenant = await this.require(tenantId)
    return {
      standardFeePercentage: tenant.standardFeePercentage,
      reducedFeePercentage: tenant.reducedFeePercentage,
      reducedFeeThreshold: tenant.reducedFeeThreshold,
      contractExpiryNoticeDays: tenant.contractExpiryNoticeDays,
    }
  }

  /** Gracia, punitorio diario y días de generación y recordatorio (Fase 11). */
  async getBillingSettings(tenantId: string): Promise<TenantBillingSettings> {
    const tenant = await this.require(tenantId)
    return {
      paymentGraceDays: tenant.paymentGraceDays,
      dailyLateFeePercentage: tenant.dailyLateFeePercentage,
      installmentGenerationDay: tenant.installmentGenerationDay,
      paymentReminderDay: tenant.paymentReminderDay,
    }
  }

  /**
   * Las inmobiliarias habilitadas. Es lo que recorre el scheduler de la Fase
   * 13, fuera de cualquier request: `tenants` no tiene filtro de tenant.
   */
  async listActive(): Promise<ActiveTenantRef[]> {
    const tenants = await this.tenants.listActive()
    return tenants.map(({ id, name, slug }) => ({ id, name, slug }))
  }

  async getAutomationSettings(
    tenantId: string,
  ): Promise<TenantAutomationSettings> {
    const tenant = await this.require(tenantId)
    return {
      installmentGenerationDay: tenant.installmentGenerationDay,
      paymentReminderDay: tenant.paymentReminderDay,
      monthlyReportDay: tenant.monthlyReportDay,
      contractExpiryNoticeDays: tenant.contractExpiryNoticeDays,
    }
  }

  private async require(tenantId: string): Promise<Tenant> {
    const tenant = await this.tenants.findById(tenantId)
    if (!tenant) throw new Error(`Tenant inexistente: ${tenantId}`)
    return tenant
  }
}
