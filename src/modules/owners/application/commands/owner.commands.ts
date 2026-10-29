import { BankAccount, OwnerFeeSettings } from '@/modules/owners/domain/owner'
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

/** Fase 12, 2.1: honorarios y modo de envío (sólo admin). */
export class UpdateOwnerFeeSettingsCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<OwnerFeeSettings>,
  ) {}
}

export class IssueOwnerPortalCredentialsCommand {
  constructor(public readonly id: string) {}
}

export class DeleteOwnerCommand {
  constructor(public readonly id: string) {}
}
