import { DomainErrorKind, DomainException } from '@/shared/errors'

/**
 * Una inmobiliaria inexistente y una deshabilitada dan el mismo 404: desde
 * afuera no se distingue si el slug existió alguna vez.
 */
export class TenantNotFoundException extends DomainException {
  constructor() {
    super(
      'TENANT_NOT_FOUND',
      'La inmobiliaria no existe',
      DomainErrorKind.NotFound,
    )
  }
}

/** El logo tiene que ser PNG, JPG, WebP o SVG de hasta 2 MB. */
export class InvalidTenantLogoException extends DomainException {
  constructor(reason: string) {
    super(
      'TENANT_INVALID_LOGO',
      `El logo no sirve: ${reason}`,
      DomainErrorKind.InvalidInput,
    )
  }
}

/** Un parámetro de cobro de la inmobiliaria fuera de rango (D-228). */
export class InvalidTenantBillingSettingException extends DomainException {
  constructor(field: string, reason: string) {
    super(
      'TENANT_INVALID_BILLING_SETTING',
      `${field}: ${reason}`,
      DomainErrorKind.InvalidInput,
      { field },
    )
  }
}
