import { Injectable } from '@nestjs/common'

import { BillingFacade, PaymentStatus } from '@/modules/billing/public'
import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { SettlementsFacade } from '@/modules/settlements/public'
import { localDateOf } from '@/shared/dates/calendar-date'
import {
  DocumentCurrency,
  DocumentData,
  DocumentKind,
  OwnerStatementDocumentData,
  PartyData,
  PaymentReceiptDocumentData,
  SettlementDocumentData,
  TerminationNoticeDocumentData,
} from '../domain/document'
import { DocumentSourceNotFoundException } from '../domain/document.exceptions'

const day = (date: Date | null): string | null =>
  date ? localDateOf(date) : null

/**
 * Arma el JSON de cada documento a partir de las facades de los módulos
 * dueños (nunca de sus tablas) y guarda el PDF resultante en el dueño.
 * `build` devuelve null cuando el documento no aplica (un pago sin recibo).
 */
@Injectable()
export class DocumentDataBuilder {
  constructor(
    private readonly settlements: SettlementsFacade,
    private readonly billing: BillingFacade,
    private readonly contracts: ContractsFacade,
    private readonly owners: OwnersFacade,
  ) {}

  async build(
    kind: DocumentKind,
    entityId: string,
  ): Promise<DocumentData | null> {
    switch (kind) {
      case DocumentKind.SETTLEMENT:
        return this.settlement(entityId)
      case DocumentKind.OWNER_STATEMENT:
        return this.statement(entityId)
      case DocumentKind.PAYMENT_RECEIPT:
        return this.receipt(entityId)
      case DocumentKind.TERMINATION_NOTICE:
        return this.termination(entityId)
    }
  }

  async attach(
    kind: DocumentKind,
    entityId: string,
    file: { key: string; url: string },
  ): Promise<void> {
    switch (kind) {
      case DocumentKind.SETTLEMENT:
        return this.settlements.attachDocument(entityId, file)
      case DocumentKind.OWNER_STATEMENT:
        return this.settlements.attachStatementDocument(entityId, file)
      case DocumentKind.PAYMENT_RECEIPT:
        return this.billing.attachReceipt(entityId, file)
      case DocumentKind.TERMINATION_NOTICE:
        return this.contracts.attachTerminationDocument(entityId, file)
    }
  }

  private async party(
    ref: { id: string; fullName: string } | null,
  ): Promise<PartyData | null> {
    if (!ref) return null
    const contact = (await this.owners.contacts([ref.id])).get(ref.id)
    return { name: ref.fullName, nationalId: contact?.nationalId ?? null }
  }

  private async settlement(id: string): Promise<SettlementDocumentData> {
    const view = await this.settlements.settlementForPdf(id)
    if (!view) throw new DocumentSourceNotFoundException('SETTLEMENT')
    return {
      period: view.period,
      sequence: view.sequence,
      currency: view.currency as DocumentCurrency,
      owner: await this.party(view.owner),
      property: view.property?.address ?? null,
      renter: view.renter?.fullName ?? null,
      payments: view.payments.map((p) => ({
        installmentPeriod: p.installmentPeriod,
        paidAt: p.paidAt,
        rent: p.rentApplied,
        lateFee: p.lateFeeApplied,
        charges: p.ownerChargesApplied,
      })),
      rentTotal: view.rentTotal,
      lateFeeTotal: view.lateFeeTotal,
      ownerChargesTotal: view.ownerChargesTotal,
      serviceChargesTotal: view.serviceChargesTotal,
      fee: {
        mode: view.feeMode,
        percentage: view.feePercentage,
        fixedAmount: view.feeAmountFixed,
        base: view.feeBase,
        total: view.feeTotal,
        deducted: view.feeDeducted,
        mixedTerms: view.mixedFeeTerms,
      },
      expenses: view.expenses.map((e) => ({
        date: e.expenseDate,
        description: e.description,
        amount: e.amount,
      })),
      adjustments: view.adjustments
        .filter((a) => a.voidedAt === null)
        .map((a) => ({
          concept: a.concept,
          description: a.description,
          amount: a.amount,
        })),
      netAmount: view.netAmount,
      transfers: view.transfers
        .filter((t) => t.voidedAt === null)
        .map((t) => ({
          date: t.transferredAt,
          amount: t.amount,
          method: t.method,
        })),
      transferredTotal: view.transferredTotal,
      confirmedAt: day(view.confirmedAt),
    }
  }

  private async statement(id: string): Promise<OwnerStatementDocumentData> {
    const view = await this.settlements.statementForPdf(id)
    if (!view) throw new DocumentSourceNotFoundException('OWNER_STATEMENT')
    // El resumen de cada liquidación no trae las cuotas: se piden una a una.
    const rows = []
    for (const summary of view.settlements) {
      const detail = await this.settlements.settlementForPdf(summary.id)
      const periods = [
        ...new Set((detail?.payments ?? []).map((p) => p.installmentPeriod)),
      ].sort()
      rows.push({
        property: summary.property?.address ?? null,
        settlementPeriod: summary.period,
        installmentPeriods: periods,
        rent: summary.rentTotal,
        lateFee: summary.lateFeeTotal,
        charges: summary.ownerChargesTotal,
        fee: summary.feeTotal,
        expenses: summary.expensesTotal,
        adjustments: summary.adjustmentsTotal,
        net: summary.netAmount,
        transferred: summary.transferredTotal,
        currency: summary.currency as DocumentCurrency,
      })
    }
    return {
      period: view.period,
      owner: await this.party(view.owner),
      sendMode: view.sendMode,
      rows,
      totals: view.totals.map((t) => ({
        currency: t.currency as DocumentCurrency,
        rent: t.rentTotal,
        lateFee: t.lateFeeTotal,
        charges: t.chargesTotal,
        fee: t.feeTotal,
        expenses: t.expensesTotal,
        adjustments: t.adjustmentsTotal,
        net: t.netTotal,
        transferred: t.transferredTotal,
      })),
      closedAt: day(view.closedAt),
    }
  }

  private async receipt(
    id: string,
  ): Promise<PaymentReceiptDocumentData | null> {
    const data = await this.billing.paymentForReceipt(id)
    if (!data) throw new DocumentSourceNotFoundException('PAYMENT_RECEIPT')
    // Sin número no hay recibo: aplicación de saldo a favor, pago sin
    // confirmar, o anulado antes de que se emitiera (A-33).
    if (!data.receiptNumber) return null
    return {
      receiptNumber: data.receiptNumber,
      voided: data.status === PaymentStatus.VOIDED,
      voidReason: data.voidReason,
      voidedAt: day(data.voidedAt),
      paidAt: data.paidAt,
      renter: data.renter
        ? { name: data.renter.fullName, nationalId: data.renter.nationalId }
        : null,
      property: data.property?.address ?? null,
      installmentPeriod: data.installment.period,
      paidCurrency: data.paidCurrency as DocumentCurrency,
      amount: data.amount,
      exchange:
        data.exchangeRate && data.exchangeRateSource && data.exchangeRateDate
          ? {
              rate: data.exchangeRate,
              source: data.exchangeRateSource,
              date: data.exchangeRateDate,
              equivalent: data.amountInContractCurrency,
            }
          : null,
      contractCurrency: data.currency as DocumentCurrency,
      method: data.method,
      receivedBy: data.receivedBy,
      allocation: {
        lateFee: data.lateFeeApplied,
        rent: data.rentApplied,
        charges: data.chargesApplied,
        creditGenerated: data.creditGenerated,
      },
      remaining: data.remaining,
      registeredBy: data.registeredBy,
      notes: data.notes,
    }
  }

  private async termination(
    id: string,
  ): Promise<TerminationNoticeDocumentData> {
    const data = await this.contracts.terminationForPdf(id)
    if (!data) throw new DocumentSourceNotFoundException('TERMINATION_NOTICE')
    return {
      property: data.property?.address ?? null,
      owner: data.owner
        ? { name: data.owner.fullName, nationalId: data.owner.nationalId }
        : null,
      renter: data.renter
        ? { name: data.renter.fullName, nationalId: data.renter.nationalId }
        : null,
      currency: data.currency as DocumentCurrency,
      startDate: data.startDate,
      endDate: data.endDate,
      notifiedAt: data.notifiedAt,
      terminatedAt: data.terminatedAt,
      currentRent: data.currentRent,
      remainingMonths: data.remainingMonths,
      remainingDays: data.remainingDays,
      totalDays: data.totalDays,
      futureRent: data.futureRent,
      penaltyPercent: data.penaltyPercent,
      penalty: data.penalty,
      deposit: data.deposit,
      depositCurrency: data.depositCurrency as DocumentCurrency,
      depositReturnMode: data.depositReturnMode,
    }
  }
}
