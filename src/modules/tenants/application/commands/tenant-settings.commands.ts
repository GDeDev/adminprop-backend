import { TenantSettingsPatch } from '../../domain/tenant.entity'

export class UpdateTenantSettingsCommand {
  constructor(
    public readonly tenantId: string,
    public readonly patch: TenantSettingsPatch,
  ) {}
}

export class UploadTenantLogoCommand {
  constructor(
    public readonly tenantId: string,
    public readonly file: Buffer,
  ) {}
}

export class DeleteTenantLogoCommand {
  constructor(public readonly tenantId: string) {}
}
