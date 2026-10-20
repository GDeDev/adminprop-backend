import { Currency } from '@/modules/services/domain/property-service'

export class CreateAdvanceExpenseCommand {
  constructor(
    public readonly contractId: string,
    public readonly data: {
      amount: string
      description: string
      expenseDate: string
      /** Si no viene, la del contrato. */
      currency: Currency | null
    },
    /** El comprobante, tal como llegó. Vacío si no mandaron archivo. */
    public readonly receipt: Buffer,
  ) {}
}

export class UpdateAdvanceExpenseCommand {
  constructor(
    public readonly id: string,
    public readonly changes: {
      amount?: string
      description?: string
      expenseDate?: string
    },
  ) {}
}

export class DeleteAdvanceExpenseCommand {
  constructor(public readonly id: string) {}
}
