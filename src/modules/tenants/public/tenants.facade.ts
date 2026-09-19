import { Injectable } from '@nestjs/common'

import { TenantRepository } from '../domain/tenant.repository'

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
}
