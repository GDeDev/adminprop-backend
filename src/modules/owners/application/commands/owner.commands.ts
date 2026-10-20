import { BankAccount } from '@/modules/owners/domain/owner'
import { OwnerPersonalData } from '@/modules/owners/domain/owner.ports'

export class CreateOwnerCommand {
  constructor(
    public readonly data: OwnerPersonalData,
    public readonly bankAccount: BankAccount,
  ) {}
}

export class UpdateOwnerCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<OwnerPersonalData>,
  ) {}
}

export class UpdateOwnerBankAccountCommand {
  constructor(
    public readonly id: string,
    public readonly bankAccount: BankAccount,
  ) {}
}

export class IssueOwnerPortalCredentialsCommand {
  constructor(public readonly id: string) {}
}

export class DeleteOwnerCommand {
  constructor(public readonly id: string) {}
}
