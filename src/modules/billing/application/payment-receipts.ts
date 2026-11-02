import { Injectable } from '@nestjs/common'

import { UsersFacade } from '@/modules/auth/public'
import { PropertiesFacade } from '@/modules/properties/public'
import { RentersFacade } from '@/modules/renters/public'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { IsoDate, Period } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  Currency,
  ExchangeRateSource,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '../domain/billing'
import {
  InstallmentRepository,
  PaymentRepository,
} from '../domain/billing.ports'
import { InstallmentPolicy } from '../domain/installment.policy'

/** Todo lo que lleva el recibo de un pago, con nombres ya resueltos (Fase 15). */
export interface PaymentReceiptData {
  paymentId: string
  /** Null hasta que se emite; `ensureReceiptNumber` lo asigna. */
  receiptNumber: string | null
  status: PaymentStatus
  voidedAt: Date | null
  voidReason: string | null
  paidAt: IsoDate
  /** Moneda y monto realmente entregados. */
  paidCurrency: Currency
  amount: string
  exchangeRate: string | null
  exchangeRateSource: ExchangeRateSource | null
  exchangeRateDate: IsoDate | null
  /** Moneda de la cuota (la del contrato) y el equivalente. */
  currency: Currency
  amountInContractCurrency: string
  kind: PaymentKind
  method: PaymentMethod
  receivedBy: PaymentReceiver
  /** Imputación en la moneda de la cuota. */
  lateFeeApplied: string
  rentApplied: string
  chargesApplied: string
  creditGenerated: string
  installment: { id: string; period: Period; baseAmount: string }
  renter: { id: string; fullName: string; nationalId: string } | null
  property: { id: string; address: string } | null
  /** Quién cargó el pago. */
  registeredBy: string | null
  notes: string | null
  /** Lo que queda de la cuota después de este pago, a la fecha del pago. */
  remaining: {
    rent: string
    lateFee: string
    charges: string
    total: string
  }
}

/**
 * Arma los datos del recibo de un pago y le asigna su número correlativo
 * (Fase 15, A-30, A-33). Vive en cobros porque es dueño de pagos y cuotas.
 */
@Injectable()
export class PaymentReceipts {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly installments: InstallmentRepository,
    private readonly renters: RentersFacade,
    private readonly properties: PropertiesFacade,
    private readonly users: UsersFacade,
    private readonly tenants: TenantsFacade,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Se numera el recibo de los cobros reales confirmados (A-33), no el de las
   * aplicaciones de saldo a favor ni el de un pago anulado que nunca tuvo uno.
   */
  isReceiptable(data: PaymentReceiptData): boolean {
    return (
      data.kind === PaymentKind.CASH_IN &&
      data.status === PaymentStatus.CONFIRMED
    )
  }

  async dataFor(paymentId: string): Promise<PaymentReceiptData | null> {
    const payment = await this.payments.findById(paymentId)
    if (!payment) return null
    const installment = await this.installments.findById(payment.installmentId)
    if (!installment) return null

    const [renters, properties, users] = await Promise.all([
      this.renters.contacts([installment.renterId]),
      this.properties.describe([installment.propertyId]),
      this.users.describe([payment.registeredById]),
    ])

    // El saldo es el de la cuota inmediatamente después de este pago: cuentan
    // los vigentes cargados antes (o a la vez) que él y el propio, aunque
    // después se haya anulado (el recibo anulado conserva lo que decía).
    const upToHere = installment.payments.filter(
      (p) =>
        p.id === payment.id ||
        (p.status !== PaymentStatus.VOIDED &&
          p.createdAt.getTime() <= payment.createdAt.getTime()),
    )
    const balances = InstallmentPolicy.balances(
      {
        ...installment,
        payments: upToHere.map((p) =>
          p.id === payment.id && p.status === PaymentStatus.VOIDED
            ? { ...p, status: PaymentStatus.CONFIRMED }
            : p,
        ),
      },
      payment.paidAt,
    )

    const renter = renters.get(installment.renterId)
    const property = properties.get(installment.propertyId)
    return {
      paymentId: payment.id,
      receiptNumber: payment.receiptNumber,
      status: payment.status,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
      paidAt: payment.paidAt,
      paidCurrency: payment.paidCurrency,
      amount: payment.amount,
      exchangeRate: payment.exchangeRate,
      exchangeRateSource: payment.exchangeRateSource,
      exchangeRateDate: payment.exchangeRateDate,
      currency: installment.currency,
      amountInContractCurrency: payment.amountInContractCurrency,
      kind: payment.kind,
      method: payment.method,
      receivedBy: payment.receivedBy,
      lateFeeApplied: payment.lateFeeApplied,
      rentApplied: payment.rentApplied,
      chargesApplied: payment.chargesApplied,
      creditGenerated: payment.creditGenerated,
      installment: {
        id: installment.id,
        period: installment.period,
        baseAmount: installment.baseAmount,
      },
      renter: renter
        ? {
            id: renter.id,
            fullName: renter.fullName,
            nationalId: renter.nationalId,
          }
        : null,
      property: property
        ? { id: property.id, address: property.address }
        : null,
      registeredBy: users.get(payment.registeredById)?.fullName ?? null,
      notes: payment.notes,
      remaining: {
        rent: balances.rentBalance,
        lateFee: balances.lateFeeBalance,
        charges: balances.chargesBalance,
        total: balances.totalDue,
      },
    }
  }

  /**
   * El número de recibo del pago: el que ya tiene, o uno nuevo del contador de
   * la inmobiliaria. Reserva y asignación van en una transacción: si algo
   * falla no se gasta el número (A-33).
   */
  async ensureNumber(paymentId: string): Promise<string> {
    const tenantId = RequestContext.tenantId
    if (!tenantId) throw new Error('Recibo fuera de un tenant')
    return this.prisma.transaction(async () => {
      const payment = await this.payments.findById(paymentId)
      if (!payment) throw new Error(`Pago inexistente: ${paymentId}`)
      if (payment.receiptNumber) return payment.receiptNumber
      const next = await this.tenants.nextReceiptNumber(tenantId)
      return this.payments.assignReceiptNumber(
        paymentId,
        formatReceiptNumber(next),
      )
    })
  }
}

/** `R-00000042`: correlativo con relleno, estable para ordenar y buscar. */
export function formatReceiptNumber(sequence: number): string {
  return `R-${String(sequence).padStart(8, '0')}`
}
