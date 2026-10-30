import { Injectable } from '@nestjs/common'

import { Period } from '@/shared/dates/calendar-date'
import { FeeAccountTotals, FeePolicy } from '../domain/fee.policy'
import { SettlementStatus } from '../domain/settlement'
import {
  FeePaymentRepository,
  FeeReceivableRepository,
  OwnerStatementRepository,
  SettlementRepository,
} from '../domain/settlement.ports'
import {
  SettlementDetailView,
  SettlementSummaryView,
  SettlementViews,
} from '../application/settlement.views'
import {
  OwnerStatementDetailView,
  OwnerStatementSummaryView,
  StatementViews,
} from '../application/statement.views'

/**
 * Lo que otros módulos pueden pedirle a liquidaciones (sección 6): el
 * portal del propietario (Fase 17), los PDFs (Fase 15) y el dashboard (Fase
 * 19). Dentro del tenant del contexto.
 */
@Injectable()
export class SettlementsFacade {
  constructor(
    private readonly settlements: SettlementRepository,
    private readonly statements: OwnerStatementRepository,
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
    private readonly settlementViews: SettlementViews,
    private readonly statementViews: StatementViews,
  ) {}

  /** Historial de un propietario, más nuevas primero. */
  async listByOwner(
    ownerId: string,
    filter: { period?: Period; status?: SettlementStatus } = {},
  ): Promise<SettlementSummaryView[]> {
    return this.settlementViews.summaries(
      await this.settlements.listAll({ ownerId, ...filter }),
    )
  }

  async statementsByOwner(
    ownerId: string,
  ): Promise<OwnerStatementSummaryView[]> {
    return this.statementViews.summaries(
      await this.statements.listAll({ ownerId }),
    )
  }

  /** Todo lo que va al PDF de la liquidación, con nombres ya resueltos. */
  async settlementForPdf(id: string): Promise<SettlementDetailView | null> {
    const settlement = await this.settlements.findById(id)
    return settlement ? this.settlementViews.detail(settlement) : null
  }

  async statementForPdf(id: string): Promise<OwnerStatementDetailView | null> {
    const statement = await this.statements.findById(id)
    return statement ? this.statementViews.detail(statement) : null
  }

  /** Devengado, cobrado, pendiente y sin imputar por moneda. */
  async feeAccountSummary(ownerId: string): Promise<FeeAccountTotals[]> {
    const [receivables, payments] = await Promise.all([
      this.receivables.listAll({ ownerId }),
      this.payments.listAll({ ownerId }),
    ])
    return FeePolicy.accountTotals(receivables, payments)
  }
}
