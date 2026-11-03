export class UpdateSiteSettingsCommand {
  constructor(
    public readonly patch: {
      template?: unknown
      theme?: unknown
      content?: unknown
      /** `undefined` no toca; `null` lo quita. */
      subdomain?: string | null
      customDomain?: string | null
    },
  ) {}
}

export class ResetSiteTemplateCommand {
  constructor(public readonly keepContent: boolean) {}
}

export class PublishSiteCommand {}

export class UnpublishSiteCommand {}

export class UploadSiteAssetCommand {
  constructor(public readonly file: Buffer) {}
}

export class VerifySiteDomainCommand {}
