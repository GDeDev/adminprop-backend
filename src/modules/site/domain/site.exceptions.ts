import { DomainErrorKind, DomainException } from '@/shared/errors'

/** El sitio público no existe o no está publicado: mismo 404 para no revelar nada. */
export class SiteNotFoundException extends DomainException {
  constructor() {
    super(
      'SITE_NOT_FOUND',
      'No encontramos este sitio',
      DomainErrorKind.NotFound,
    )
  }
}

export class SubdomainTakenException extends DomainException {
  constructor() {
    super(
      'SUBDOMAIN_TAKEN',
      'Ese subdominio ya está en uso. Probá con otro.',
      DomainErrorKind.Conflict,
    )
  }
}

export class DomainTakenException extends DomainException {
  constructor() {
    super(
      'DOMAIN_TAKEN',
      'Ese dominio ya está asociado a otro sitio.',
      DomainErrorKind.Conflict,
    )
  }
}

export class InvalidSiteImageException extends DomainException {
  constructor(reason: string) {
    super(
      'INVALID_SITE_IMAGE',
      `La imagen no es válida: ${reason}`,
      DomainErrorKind.InvalidInput,
    )
  }
}

export class SiteAssetLimitException extends DomainException {
  constructor(limit: number) {
    super(
      'SITE_ASSET_LIMIT',
      `Llegaste al máximo de ${limit} imágenes del sitio.`,
      DomainErrorKind.BusinessRule,
    )
  }
}
