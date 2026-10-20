import { Tenant } from '../domain/tenant.entity'

/** Lo que el front necesita para pintar la marca de la inmobiliaria. */
export interface TenantBrandingView {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  /** Hex (`#1a2b3c`). El front lo aplica sobre `--primary`. */
  primaryColor: string | null
}

export function toTenantBrandingView(tenant: Tenant): TenantBrandingView {
  return {
    id: tenant.id,
    name: tenant.name,
    slug: tenant.slug,
    logoUrl: tenant.logoUrl,
    primaryColor: tenant.primaryColor,
  }
}
