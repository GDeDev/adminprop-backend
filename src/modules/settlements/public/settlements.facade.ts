import { Injectable } from '@nestjs/common'

import { Period } from '@/shared/dates/calendar-date'
import { FeeAccountTotals, FeePolicy } from '../domain/fee.policy'
import { SettlementNothingToAcknowledgeException } from '../domain/settlement.exceptions'
import {
  Settlement,
  SettlementStatus,
  StatementStatus,
} from '../domain/settlement'
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

  /**
   * Las liquidaciones que el propietario ve en su portal (A-36): sólo las
   * confirmadas o transferidas; los borradores y las canceladas son
   * internos. Más nuevas primero.
   */
  async pageForOwner(
    ownerId: string,
    filter: { propertyId?: string; period?: Period },
    page: { skip: number; take: number },
  ): Promise<[SettlementSummaryView[], number]> {
    const [rows, total] = await this.settlements.list(
      { ownerId, ...filter, statuses: PORTAL_VISIBLE },
      page,
    )
    return [await this.settlementViews.summaries(rows), total]
  }

  /** La ficha de una liquidación del propietario, o null si no es suya o no es visible. */
  async findForOwner(
    ownerId: string,
    id: string,
  ): Promise<SettlementDetailView | null> {
    const settlement = await this.settlements.findById(id)
    if (!isVisibleTo(settlement, ownerId)) return null
    return this.settlementViews.detail(settlement)
  }

  /**
   * "Recibí la transferencia" (Fase 17, A-37): deja constancia de cuándo el
   * propietario lo confirmó. Idempotente: el segundo acuse no pisa al primero.
   * Null si la liquidación no es suya; 422 si todavía no se le transfirió nada.
   */
  async acknowledgeForOwner(
    ownerId: string,
    id: string,
  ): Promise<SettlementDetailView | null> {
    const settlement = await this.settlements.findById(id)
    if (!isVisibleTo(settlement, ownerId)) return null
    if (settlement.acknowledgedAt === null) {
      if (Number(settlement.transferredTotal) <= 0) {
        throw new SettlementNothingToAcknowledgeException(id)
      }
      await this.settlements.update(id, { acknowledgedAt: new Date() })
    }
    return this.findForOwner(ownerId, id)
  }

  /** Los consolidados cerrados del propietario (el abierto es un borrador), más nuevos primero. */
  async pageStatementsForOwner(
    ownerId: string,
    page: { skip: number; take: number },
  ): Promise<[OwnerStatementSummaryView[], number]> {
    const [rows, total] = await this.statements.list(
      { ownerId, status: StatementStatus.CLOSED },
      page,
    )
    return [await this.statementViews.summaries(rows), total]
  }

  /** El consolidado cerrado del propietario, o null si no es suyo o sigue abierto. */
  async findStatementForOwner(
    ownerId: string,
    id: string,
  ): Promise<OwnerStatementDetailView | null> {
    const statement = await this.statements.findById(id)
    if (
      !statement ||
      statement.ownerId !== ownerId ||
      statement.status !== StatementStatus.CLOSED
    ) {
      return null
    }
    return this.statementViews.detail(statement)
  }

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

  /** Guarda el PDF vigente de la liquidación (Fase 15). */
  async attachDocument(
    settlementId: string,
    file: { key: string; url: string },
  ): Promise<void> {
    await this.settlements.update(settlementId, {
      pdfKey: file.key,
      pdfUrl: file.url,
    })
  }

  /** Guarda el PDF vigente del consolidado (Fase 15). */
  async attachStatementDocument(
    statementId: string,
    file: { key: string; url: string },
  ): Promise<void> {
    await this.statements.update(statementId, {
      pdfKey: file.key,
      pdfUrl: file.url,
    })
  }

  /** De quién es la liquidación, para autorizar la descarga (Fase 15). */
  async settlementOwnerId(id: string): Promise<string | null> {
    return (await this.settlements.findById(id))?.ownerId ?? null
  }

  /** De quién es el consolidado, para autorizar la descarga (Fase 15). */
  async statementOwnerId(id: string): Promise<string | null> {
    return (await this.statements.findById(id))?.ownerId ?? null
  }

  /**
   * Propietarios con liquidaciones confirmadas o transferidas de ese mes
   * (`settlements.period`) que todavía no entraron en ningún consolidado: el
   * cierre es manual (Micaela #7) y el cron sólo recuerda (Fase 13).
   */
  async ownersPendingStatement(
    period: Period,
  ): Promise<{ ownerId: string; settlements: number }[]> {
    const settlements = await this.settlements.listAll({
      period,
      statuses: [SettlementStatus.CONFIRMED, SettlementStatus.TRANSFERRED],
      statementId: null,
    })
    const counts = new Map<string, number>()
    for (const settlement of settlements) {
      counts.set(settlement.ownerId, (counts.get(settlement.ownerId) ?? 0) + 1)
    }
    return [...counts].map(([ownerId, count]) => ({
      ownerId,
      settlements: count,
    }))
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

const PORTAL_VISIBLE = [
  SettlementStatus.CONFIRMED,
  SettlementStatus.TRANSFERRED,
]

function isVisibleTo(
  settlement: Settlement | null,
  ownerId: string,
): settlement is Settlement {
  return (
    settlement !== null &&
    settlement.ownerId === ownerId &&
    PORTAL_VISIBLE.includes(settlement.status)
  )
}
