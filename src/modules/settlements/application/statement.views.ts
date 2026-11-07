import { Injectable } from '@nestjs/common'

import { UserRef, UsersFacade } from '@/modules/auth/public'
import { OwnerRef, OwnersFacade } from '@/modules/owners/public'
import { Period } from '@/shared/dates/calendar-date'
import {
  OwnerStatement,
  OwnerStatementTotals,
  Settlement,
  StatementSendMode,
  StatementStatus,
} from '../domain/settlement'
import { SettlementRepository } from '../domain/settlement.ports'
import { SettlementPolicy } from '../domain/settlement.policy'
import { SettlementSummaryView, SettlementViews } from './settlement.views'

/** Un consolidado en el listado (`OwnerStatementSummaryDto`). */
export interface OwnerStatementSummaryView {
  id: string
  owner: OwnerRef | null
  period: Period
  status: StatementStatus
  sendMode: StatementSendMode
  settlementsCount: number
  /** Congelados si está cerrado; en vivo si está abierto. */
  totals: OwnerStatementTotals[]
  closedAt: Date | null
  /** PDF vigente; null mientras no se generó (Fase 15). */
  pdfUrl: string | null
  createdAt: Date
}

export interface OwnerStatementDetailView extends OwnerStatementSummaryView {
  settlements: SettlementSummaryView[]
  closedBy: UserRef | null
  notes: string | null
}

/**
 * Arma las vistas del consolidado. Mientras está abierto, los totales se
 * calculan con sus liquidaciones al momento; cerrado, se leen los congelados.
 */
@Injectable()
export class StatementViews {
  constructor(
    private readonly owners: OwnersFacade,
    private readonly users: UsersFacade,
    private readonly settlements: SettlementRepository,
    private readonly settlementViews: SettlementViews,
  ) {}

  async summaries(
    statements: OwnerStatement[],
  ): Promise<OwnerStatementSummaryView[]> {
    if (statements.length === 0) return []
    const [owners, members] = await Promise.all([
      this.owners.describe(statements.map((s) => s.ownerId)),
      this.membersOf(
        statements.filter((s) => s.status === StatementStatus.OPEN),
      ),
    ])
    return statements.map((statement) =>
      this.toSummary(
        statement,
        owners,
        members.filter((s) => s.statementId === statement.id),
      ),
    )
  }

  async detail(statement: OwnerStatement): Promise<OwnerStatementDetailView> {
    const [owners, members, users] = await Promise.all([
      this.owners.describe([statement.ownerId]),
      this.settlements.listAll({ statementId: statement.id }),
      this.users.describe(statement.closedById ? [statement.closedById] : []),
    ])
    return {
      ...this.toSummary(statement, owners, members),
      settlements: await this.settlementViews.summaries(members),
      closedBy: statement.closedById
        ? (users.get(statement.closedById) ?? null)
        : null,
      notes: statement.notes,
    }
  }

  private toSummary(
    statement: OwnerStatement,
    owners: Map<string, OwnerRef>,
    members: Settlement[],
  ): OwnerStatementSummaryView {
    return {
      id: statement.id,
      owner: owners.get(statement.ownerId) ?? null,
      period: statement.period,
      status: statement.status,
      sendMode: statement.sendMode,
      settlementsCount: statement.settlementsCount,
      totals:
        statement.status === StatementStatus.CLOSED
          ? statement.totals
          : SettlementPolicy.statementTotals(members),
      closedAt: statement.closedAt,
      pdfUrl: statement.pdfUrl,
      createdAt: statement.createdAt,
    }
  }

  private membersOf(open: OwnerStatement[]): Promise<Settlement[]> {
    if (open.length === 0) return Promise.resolve([])
    return this.settlements.listAll({ statementIds: open.map((o) => o.id) })
  }
}
