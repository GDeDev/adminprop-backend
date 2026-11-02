import { Injectable } from '@nestjs/common'

import { IsoDate, Period } from '@/shared/dates/calendar-date'
import { FeeAccountTotals, FeePolicy } from '../domain/fee.policy'
import { SettlementNothingToAcknowledgeException } from '../domain/settlement.exceptions'
import {
  Currency,
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

  /**
   * Las liquidaciones confirmadas o transferidas de un rango de períodos
   * (`settlements.period`, inclusive), con sus transferencias vigentes. Los
   * borradores y las canceladas no figuran en ningún reporte.
   */
  async reportSettlements(
    periodFrom: Period,
    periodTo: Period,
  ): Promise<ReportSettlementRef[]> {
    const settlements = await this.settlements.listAll({
      periodFrom,
      periodTo,
      statuses: [SettlementStatus.CONFIRMED, SettlementStatus.TRANSFERRED],
    })
    return settlements.map((settlement) => ({
      id: settlement.id,
      ownerId: settlement.ownerId,
      propertyId: settlement.propertyId,
      period: settlement.period,
      currency: settlement.currency,
      status: settlement.status,
      netAmount: settlement.netAmount,
      feeTotal: settlement.feeTotal,
      feeDeducted: settlement.feeDeducted,
      transfers: settlement.transfers
        .filter((transfer) => transfer.voidedAt === null)
        .map(({ transferredAt, amount }) => ({ transferredAt, amount })),
    }))
  }

  /** Pagos de honorarios vigentes con `paidAt` en el rango (inclusive). */
  async reportFeePayments(
    paidFrom: IsoDate,
    paidTo: IsoDate,
  ): Promise<ReportFeePaymentRef[]> {
    const payments = await this.payments.listAll({
      activeOnly: true,
      paidFrom,
      paidTo,
    })
    return payments.map(({ paidAt, amount, currency }) => ({
      paidAt,
      amount,
      currency,
    }))
  }

  /** Pendientes de acción: borradores, confirmadas sin transferir y consolidados abiertos. */
  async workload(): Promise<SettlementWorkload> {
    const [toConfirm, toTransfer, openStatements] = await Promise.all([
      this.settlements.listAll({ status: SettlementStatus.PENDING }),
      this.settlements.listAll({ status: SettlementStatus.CONFIRMED }),
      this.statements.listAll({ status: StatementStatus.OPEN }),
    ])
    return {
      toConfirm: toConfirm.length,
      toTransfer: toTransfer.length,
      openStatements: openStatements.length,
    }
  }
}

/** Una liquidación con lo que los reportes necesitan (Fase 19). */
export interface ReportSettlementRef {
  id: string
  ownerId: string
  propertyId: string
  period: Period
  currency: Currency
  status: SettlementStatus
  netAmount: string
  feeTotal: string
  /** Si el honorario se descontó del neto (si no, queda por cobrar). */
  feeDeducted: boolean
  /** Transferencias vigentes (las anuladas no cuentan). */
  transfers: { transferredAt: IsoDate; amount: string }[]
}

/** Un pago de honorarios vigente, para los reportes (Fase 19). */
export interface ReportFeePaymentRef {
  paidAt: IsoDate
  amount: string
  currency: Currency
}

/** Cuántas liquidaciones y consolidados esperan una acción (dashboard, Fase 19). */
export interface SettlementWorkload {
  toConfirm: number
  toTransfer: number
  openStatements: number
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
