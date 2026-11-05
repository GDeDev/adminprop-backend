import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import {
  CreditStatus,
  Currency,
  Installment,
  InstallmentStatus,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
  RenterCredit,
} from '@/modules/billing/domain/billing'
import {
  CreditNotAvailableException,
  CreditNotFoundException,
  InstallmentAlreadyPaidException,
  InvalidPaymentDateException,
  PaymentAlreadyConfirmedException,
  PaymentAlreadyVoidedException,
  PaymentCreditAlreadyUsedException,
  PaymentNotFoundException,
} from '@/modules/billing/domain/billing.exceptions'
import {
  InstallmentRepository,
  PaymentRepository,
  RenterCreditRepository,
} from '@/modules/billing/domain/billing.ports'
import {
  InstallmentBalances,
  InstallmentPolicy,
} from '@/modules/billing/domain/installment.policy'
import {
  CreditApplicationPlan,
  PaymentPolicy,
} from '@/modules/billing/domain/payment.policy'
import { StoragePort } from '@/platform/storage/storage.port'
import { IdempotencyService } from '@/shared/idempotency/idempotency.service'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { IsoDate, todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { compareMoney, subtractMoney, toMoneyString } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { BillingReferences } from '../billing-references'
import {
  PaymentConfirmedEvent,
  PaymentVoidedEvent,
} from '../events/payment-events'
import { InstallmentRecalculator } from '../installment-recalculator'
import {
  InstallmentDetailView,
  InstallmentViews,
  PaymentView,
  RenterCreditView,
  toCreditView,
  toPaymentView,
} from '../installment.views'
import {
  ApplyCreditCommand,
  ConfirmPaymentCommand,
  RefundCreditCommand,
  RegisterPaymentCommand,
  VoidPaymentCommand,
} from './billing.commands'

/** `scope` de la clave de idempotencia de registrar un pago. */
export const REGISTER_PAYMENT_SCOPE = 'billing.register-payment'

/**
 * Lo que se guarda con la clave para reconstruir la respuesta: ids, no la
 * respuesta entera, así un reintento devuelve el estado actual de la cuota.
 */
interface StoredPayment {
  paymentId: string
  creditApplicationIds: string[]
}

/** Lo que devuelven registrar un pago y aplicar un saldo a favor. */
export interface RegisterPaymentResult {
  payment: PaymentView
  creditApplications: PaymentView[]
  installment: InstallmentDetailView
}

function requireUser(): string {
  const userId = RequestContext.userId
  if (!userId) throw new Error('Operación de cobros sin usuario en el contexto')
  return userId
}

/**
 * Avisa a liquidaciones (Fase 12) de cada pago que quedó confirmado. Se
 * emite después de la transacción: si ella falla, no hay aviso que retirar.
 */
function publishConfirmed(
  eventBus: EventBus,
  installment: Installment,
  payments: Payment[],
): void {
  for (const payment of payments) {
    if (payment.status !== PaymentStatus.CONFIRMED) continue
    eventBus.publish(
      new PaymentConfirmedEvent(
        payment,
        { ownerId: installment.ownerId, period: installment.period },
        installment.currency,
      ),
    )
  }
}

/**
 * Aplica saldos a favor a una cuota (regla 5): un pago `CREDIT_APPLICATION`
 * por cada crédito del plan, imputado con el orden por defecto sobre los
 * saldos que van quedando. Devuelve los pagos creados y los saldos finales.
 */
async function applyCreditPlan(
  deps: {
    payments: PaymentRepository
    credits: RenterCreditRepository
  },
  installment: Installment,
  plan: CreditApplicationPlan[],
  balances: InstallmentBalances,
  paidAt: IsoDate,
  registeredById: string,
): Promise<{ created: Payment[]; balances: InstallmentBalances }> {
  const created: Payment[] = []
  let remaining = balances
  for (const { credit, amount } of plan) {
    const allocation = PaymentPolicy.allocate(amount, remaining, null)
    const payment = await deps.payments.create({
      installmentId: installment.id,
      contractId: installment.contractId,
      renterId: installment.renterId,
      paidAt,
      paidCurrency: installment.currency,
      amount,
      exchangeRate: null,
      exchangeRateSource: null,
      exchangeRateDate: null,
      amountInContractCurrency: amount,
      kind: PaymentKind.CREDIT_APPLICATION,
      method: PaymentMethod.CREDIT,
      receivedBy: PaymentReceiver.AGENCY,
      status: PaymentStatus.CONFIRMED,
      ...allocation,
      creditId: credit.id,
      receiptKey: null,
      receiptUrl: null,
      registeredById,
      notes: null,
    })
    const left = toMoneyString(subtractMoney(credit.remaining, amount))
    await deps.credits.update(credit.id, {
      remaining: left,
      status:
        compareMoney(left, '0') === 0
          ? CreditStatus.APPLIED
          : CreditStatus.AVAILABLE,
    })
    created.push(payment)
    remaining = PaymentPolicy.remainingAfter(remaining, allocation)
  }
  return { created, balances: remaining }
}

/**
 * Registrar un pago (3.3, reglas 4, 5, 10; Micaela #2, #6, #9). Con
 * `applyCredit` se aplican antes los saldos a favor del inquilino; después el
 * pago se convierte a la moneda del contrato y se imputa (por defecto
 * punitorio → alquiler → cargos); lo que sobra nace como saldo a favor. El
 * comprobante es opcional (D-74). Todo en una transacción (D-52); el archivo
 * se sube antes y se borra si la transacción falla.
 */
@CommandHandler(RegisterPaymentCommand)
export class RegisterPaymentHandler implements ICommandHandler<
  RegisterPaymentCommand,
  RegisterPaymentResult
> {
  private readonly logger = createLogger('RegisterPaymentHandler')

  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly payments: PaymentRepository,
    private readonly credits: RenterCreditRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly storage: StoragePort,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
    private readonly eventBus: EventBus,
    private readonly idempotency: IdempotencyService,
  ) {}

  async execute(
    command: RegisterPaymentCommand,
  ): Promise<RegisterPaymentResult> {
    const { data } = command
    const today = todayIso()
    const registeredById = requireUser()
    const installment = await this.references.requireInstallment(
      command.installmentId,
    )
    const paidAt = PaymentPolicy.normalizePaidAt(data.paidAt, today)
    const amount = PaymentPolicy.normalizeAmount(data.amount)
    const conversion = PaymentPolicy.convert(
      amount,
      data.paidCurrency,
      installment.currency,
      {
        rate: data.exchangeRate,
        source: data.exchangeRateSource,
        date: data.exchangeRateDate,
      },
    )
    const manual = PaymentPolicy.parseAllocation(data.allocation)
    const receivedBy = PaymentPolicy.receiver(
      data.receivedBy,
      installment.collectionMode,
    )
    const receipt = PaymentPolicy.receiptKind(command.receipt)
    const notes = InstallmentPolicy.normalizeNotes(data.notes)

    // Falla rápido, antes de subir el comprobante. No es la verificación que
    // vale: esa se repite adentro de la transacción, con la cuota bloqueada. Con
    // clave de idempotencia se saltea: el reintento de un pago que saldó la
    // cuota tiene que devolver ese pago, no un 409.
    const key = command.idempotencyKey
    if (
      !key &&
      compareMoney(
        InstallmentPolicy.balances(installment, paidAt).totalDue,
        '0',
      ) <= 0
    ) {
      throw new InstallmentAlreadyPaidException(installment.id)
    }
    const requestHash = key
      ? IdempotencyService.hashRequest(
          installment.id,
          JSON.stringify(data),
          command.receipt,
        )
      : ''

    const stored = receipt
      ? await this.storage.upload(
          command.receipt,
          `payments/${installment.contractId}/${randomUUID()}.${receipt.extension}`,
          { contentType: receipt.contentType, access: 'private' },
        )
      : null

    try {
      const result = await this.prisma.transaction(async () => {
        if (key) {
          const started = await this.idempotency.begin(
            REGISTER_PAYMENT_SCOPE,
            key,
            requestHash,
          )
          if (started.replay) {
            return { replay: started.response as StoredPayment }
          }
          await this.idempotency.purgeExpired()
        }

        // El lock va antes de leer saldos: dos pagos sobre la misma cuota se
        // serializan, y el segundo calcula contra lo que dejó el primero. Sin
        // esto los dos leían el mismo saldo y los dos lo imputaban entero.
        await this.installments.lockForUpdate(installment.id)
        const current = await this.references.requireInstallment(installment.id)
        const balances = InstallmentPolicy.balances(current, paidAt)
        if (compareMoney(balances.totalDue, '0') <= 0) {
          throw new InstallmentAlreadyPaidException(installment.id)
        }

        let remaining = balances
        let creditApplications: Payment[] = []
        if (data.applyCredit) {
          const available = await this.credits.listAvailable(
            installment.renterId,
            installment.currency,
          )
          const plan = PaymentPolicy.planCreditApplications(
            available,
            remaining.totalDue,
            installment.currency,
          )
          const applied = await applyCreditPlan(
            { payments: this.payments, credits: this.credits },
            installment,
            plan,
            remaining,
            paidAt,
            registeredById,
          )
          creditApplications = applied.created
          remaining = applied.balances
        }

        const allocation = PaymentPolicy.allocate(
          conversion.amountInContractCurrency,
          remaining,
          manual,
        )
        const payment = await this.payments.create({
          installmentId: installment.id,
          contractId: installment.contractId,
          renterId: installment.renterId,
          paidAt,
          paidCurrency: data.paidCurrency,
          amount,
          exchangeRate: conversion.exchangeRate?.rate ?? null,
          exchangeRateSource: conversion.exchangeRate?.source ?? null,
          exchangeRateDate: conversion.exchangeRate?.date ?? null,
          amountInContractCurrency: conversion.amountInContractCurrency,
          kind: PaymentKind.CASH_IN,
          method: data.method,
          receivedBy,
          status: PaymentPolicy.initialStatus(receivedBy),
          ...allocation,
          creditId: null,
          receiptKey: stored?.key ?? null,
          receiptUrl: stored?.url ?? null,
          registeredById,
          notes,
        })
        if (compareMoney(allocation.creditGenerated, '0') > 0) {
          await this.credits.create({
            renterId: installment.renterId,
            contractId: installment.contractId,
            currency: installment.currency,
            amount: allocation.creditGenerated,
            originPaymentId: payment.id,
          })
        }
        const updated = await this.recalculator.recalculate(installment.id)
        if (key) {
          const record: StoredPayment = {
            paymentId: payment.id,
            creditApplicationIds: creditApplications.map((p) => p.id),
          }
          await this.idempotency.complete(REGISTER_PAYMENT_SCOPE, key, {
            ...record,
          })
        }
        return { replay: null, payment, creditApplications, updated }
      })
      if (result.replay) {
        // Ya estaba hecho: el comprobante que se acaba de subir sobra.
        if (stored) await discard(this.storage, this.logger, stored.key)
        return await this.replayed(result.replay)
      }
      publishConfirmed(this.eventBus, result.updated, [
        ...result.creditApplications,
        result.payment,
      ])
      return this.toResult(
        result.payment,
        result.creditApplications,
        result.updated,
      )
    } catch (error) {
      if (stored) await discard(this.storage, this.logger, stored.key)
      throw error
    }
  }

  /** La respuesta de la primera vez, con el estado actual de la cuota. */
  private async replayed(
    record: StoredPayment,
  ): Promise<RegisterPaymentResult> {
    const payment = await this.payments.findById(record.paymentId)
    if (!payment) throw new PaymentNotFoundException(record.paymentId)
    const creditApplications: Payment[] = []
    for (const id of record.creditApplicationIds) {
      const found = await this.payments.findById(id)
      if (found) creditApplications.push(found)
    }
    const installment = await this.references.requireInstallment(
      payment.installmentId,
    )
    return this.toResult(payment, creditApplications, installment)
  }

  private async toResult(
    payment: Payment,
    creditApplications: Payment[],
    installment: Installment,
  ): Promise<RegisterPaymentResult> {
    const detail = await this.views.detail(installment)
    const byId = new Map(detail.payments.map((p) => [p.id, p]))
    return {
      payment:
        byId.get(payment.id) ??
        toPaymentView(payment, installment.period, new Map()),
      creditApplications: creditApplications.map(
        (p) =>
          byId.get(p.id) ?? toPaymentView(p, installment.period, new Map()),
      ),
      installment: detail,
    }
  }
}

/** Aplicar saldo a favor a mano (regla 5), sin plata: sólo `CREDIT_APPLICATION`. */
@CommandHandler(ApplyCreditCommand)
export class ApplyCreditHandler implements ICommandHandler<
  ApplyCreditCommand,
  RegisterPaymentResult
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly installments: InstallmentRepository,
    private readonly payments: PaymentRepository,
    private readonly credits: RenterCreditRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ApplyCreditCommand): Promise<RegisterPaymentResult> {
    const today = todayIso()
    const registeredById = requireUser()
    const installment = await this.references.requireInstallment(
      command.installmentId,
    )

    const { created, updated } = await this.prisma.transaction(async () => {
      // Mismo orden que al registrar un pago: lock, y recién ahí saldos y
      // créditos, leídos dentro de la transacción.
      await this.installments.lockForUpdate(installment.id)
      const current = await this.references.requireInstallment(installment.id)
      const balances = InstallmentPolicy.balances(current, today)
      if (compareMoney(balances.totalDue, '0') <= 0) {
        throw new InstallmentAlreadyPaidException(installment.id)
      }
      const available = await this.credits.listAvailable(
        installment.renterId,
        installment.currency,
      )
      const plan = PaymentPolicy.planCreditApplications(
        available,
        balances.totalDue,
        installment.currency,
        { creditId: command.creditId, amount: command.amount },
      )
      if (plan.length === 0) throw new CreditNotAvailableException()

      const applied = await applyCreditPlan(
        { payments: this.payments, credits: this.credits },
        installment,
        plan,
        balances,
        today,
        registeredById,
      )
      return {
        created: applied.created,
        updated: await this.recalculator.recalculate(installment.id),
      }
    })
    publishConfirmed(this.eventBus, updated, created)
    const detail = await this.views.detail(updated)
    const byId = new Map(detail.payments.map((p) => [p.id, p]))
    const views = created.map(
      (p) => byId.get(p.id) ?? toPaymentView(p, installment.period, new Map()),
    )
    return {
      payment: views[0],
      creditApplications: views.slice(1),
      installment: detail,
    }
  }
}

/** Confirmar un pago informado por el propietario (regla 8, A-11). */
@CommandHandler(ConfirmPaymentCommand)
export class ConfirmPaymentHandler implements ICommandHandler<
  ConfirmPaymentCommand,
  PaymentView
> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly installments: InstallmentRepository,
    private readonly views: InstallmentViews,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: ConfirmPaymentCommand): Promise<PaymentView> {
    const payment = await this.payments.findById(command.paymentId)
    if (!payment) throw new PaymentNotFoundException(command.paymentId)
    if (payment.status === PaymentStatus.VOIDED) {
      throw new PaymentAlreadyVoidedException(payment.id)
    }
    if (payment.status === PaymentStatus.CONFIRMED) {
      throw new PaymentAlreadyConfirmedException(payment.id)
    }
    const confirmed = await this.payments.confirm(payment.id, {
      confirmedById: requireUser(),
      confirmedAt: new Date(),
    })
    if (!confirmed) {
      // Entre la lectura y el UPDATE lo confirmó o lo anuló otro request.
      const current = await this.payments.findById(payment.id)
      throw current?.status === PaymentStatus.VOIDED
        ? new PaymentAlreadyVoidedException(payment.id)
        : new PaymentAlreadyConfirmedException(payment.id)
    }
    const installment = await this.installments.findById(payment.installmentId)
    if (installment) publishConfirmed(this.eventBus, installment, [confirmed])
    const detail = installment ? await this.views.detail(installment) : null
    return (
      detail?.payments.find((p) => p.id === confirmed.id) ??
      toPaymentView(confirmed, installment?.period ?? '', new Map())
    )
  }
}

/**
 * Anular un pago (regla 7, sólo admin). Deja de contar en todo; el crédito
 * que generó tiene que estar entero (si no, 409) y pasa a VOIDED; anular una
 * aplicación de crédito devuelve el monto al crédito. La cuota se recalcula
 * y, si estaba congelada, vuelve a calcularse en vivo.
 */
@CommandHandler(VoidPaymentCommand)
export class VoidPaymentHandler implements ICommandHandler<
  VoidPaymentCommand,
  InstallmentDetailView
> {
  constructor(
    private readonly payments: PaymentRepository,
    private readonly credits: RenterCreditRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly views: InstallmentViews,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: VoidPaymentCommand): Promise<InstallmentDetailView> {
    const payment = await this.payments.findById(command.paymentId)
    if (!payment) throw new PaymentNotFoundException(command.paymentId)
    if (payment.status === PaymentStatus.VOIDED) {
      throw new PaymentAlreadyVoidedException(payment.id)
    }
    const reason = InstallmentPolicy.normalizeReason(command.reason)
    const voidedById = requireUser()

    const generated =
      compareMoney(payment.creditGenerated, '0') > 0
        ? await this.credits.findByOriginPayment(payment.id)
        : null
    if (
      generated &&
      (generated.status !== CreditStatus.AVAILABLE ||
        compareMoney(generated.remaining, generated.amount) !== 0)
    ) {
      throw new PaymentCreditAlreadyUsedException(generated.id)
    }

    const updated = await this.prisma.transaction(async () => {
      // Primero se reserva la anulación: si dos requests anulan el mismo pago,
      // el segundo espera el lock de la fila, ve que ya está anulado y falla
      // sin tocar el crédito (una aplicación de crédito devolvía el saldo dos
      // veces).
      const voided = await this.payments.void(payment.id, {
        voidedById,
        voidedAt: new Date(),
        voidReason: reason,
      })
      if (!voided) throw new PaymentAlreadyVoidedException(payment.id)
      if (generated) {
        await this.credits.update(generated.id, {
          remaining: toMoneyString('0'),
          status: CreditStatus.VOIDED,
        })
      }
      if (payment.kind === PaymentKind.CREDIT_APPLICATION && payment.creditId) {
        const credit = await this.credits.findById(payment.creditId)
        if (credit) {
          await this.credits.update(credit.id, {
            remaining: toMoneyString(
              subtractMoney(
                credit.remaining,
                `-${payment.amountInContractCurrency}`,
              ),
            ),
            status: CreditStatus.AVAILABLE,
          })
        }
      }
      return {
        voided,
        installment: await this.recalculator.recalculate(payment.installmentId),
      }
    })
    // Liquidaciones (Fase 12) decide qué hacer si el pago ya estaba liquidado
    // (A-19); los de aplicación de crédito y los PENDING_CONFIRMATION no
    // habían devengado nada todavía, pero el aviso viaja igual: es barato.
    this.eventBus.publish(
      new PaymentVoidedEvent(
        updated.voided,
        {
          ownerId: updated.installment.ownerId,
          period: updated.installment.period,
        },
        updated.installment.currency,
      ),
    )
    return this.views.detail(updated.installment)
  }
}

/** Devolución de un saldo a favor (3.6, sólo admin): registrada, no borrada. */
@CommandHandler(RefundCreditCommand)
export class RefundCreditHandler implements ICommandHandler<
  RefundCreditCommand,
  RenterCreditView
> {
  constructor(private readonly credits: RenterCreditRepository) {}

  async execute(command: RefundCreditCommand): Promise<RenterCreditView> {
    const credit = await this.credits.findById(command.creditId)
    if (!credit) throw new CreditNotFoundException(command.creditId)
    if (credit.status !== CreditStatus.AVAILABLE) {
      throw new CreditNotAvailableException(
        'el saldo ya se aplicó, se devolvió o se anuló',
      )
    }
    let refundedAt: IsoDate
    try {
      refundedAt = PaymentPolicy.normalizePaidAt(command.refundedAt, todayIso())
    } catch (error) {
      if (error instanceof InvalidPaymentDateException) {
        throw new InvalidPaymentDateException(
          error.message.replace('La fecha no sirve: ', ''),
          'refundedAt',
        )
      }
      throw error
    }
    const refunded = await this.credits.update(credit.id, {
      remaining: toMoneyString('0'),
      status: CreditStatus.REFUNDED,
      refundedAt,
      refundMethod: command.method,
      refundedById: requireUser(),
      refundNotes: InstallmentPolicy.normalizeNotes(command.notes),
    })
    return toCreditView(refunded)
  }
}

async function discard(
  storage: StoragePort,
  logger: ReturnType<typeof createLogger>,
  key: string,
): Promise<void> {
  try {
    await storage.delete(key)
  } catch (error) {
    logger.warn(
      { key, error: errorMessage(error) },
      'No se pudo borrar el comprobante de un pago que no se guardó',
    )
  }
}

export { Currency, InstallmentStatus, RenterCredit }
