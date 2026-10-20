import { GuarantorData } from '@/modules/renters/domain/guarantor.ports'

export class CreateGuarantorCommand {
  constructor(public readonly data: GuarantorData) {}
}

export class UpdateGuarantorCommand {
  constructor(
    public readonly id: string,
    public readonly changes: Partial<GuarantorData>,
  ) {}
}

export class DeleteGuarantorCommand {
  constructor(public readonly id: string) {}
}
