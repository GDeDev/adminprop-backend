import { RenterPersonalData } from '@/modules/renters/domain/renter.ports'

export class CreateRenterCommand {
  constructor(public readonly data: RenterPersonalData) {}
}

export class UpdateRenterCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<RenterPersonalData>,
  ) {}
}

export class IssueRenterPortalCredentialsCommand {
  constructor(public readonly id: string) {}
}

export class DeleteRenterCommand {
  constructor(public readonly id: string) {}
}
