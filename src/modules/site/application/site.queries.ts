export class ListSiteTemplatesQuery {}
export class GetSiteSettingsQuery {}
export class GetSitePreviewTokenQuery {}
export class CheckSubdomainQuery {
  constructor(public readonly value: string) {}
}
export class GetPublicSiteQuery {
  constructor(
    public readonly slug: string,
    public readonly previewToken: string | null,
  ) {}
}
export class ResolveSiteHostQuery {
  constructor(public readonly host: string) {}
}

export class GetSiteDomainQuery {}
