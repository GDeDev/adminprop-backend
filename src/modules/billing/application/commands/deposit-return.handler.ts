import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'

import { UsersFacade } from '@/modules/auth/public'
import {
  Currency,
  DepositDeductionConcept,
  DepositReturnMode,
  Installment,
  Payment,
  PaymentKind,
  PaymentMethod,
  PaymentReceiver,
  PaymentStatus,
} from '@/modules/billing/domain/billing'
import {
  DepositReturnExistsException,
  InstallmentNotFoundException,
  InvalidDepositDeductionException,
} from '@/modules/billing/domain/billing.exceptions'
import {
  DepositReturnRepository,
  InstallmentRepository,
  PaymentRepository,
} from '@/modules/billing/domain/billing.ports'
import {
  DeductionInput,
  DepositReturnPolicy,
} from '@/modules/billing/domain/deposit-return.policy'
import { InstallmentPolicy } from '@/modules/billing/domain/installment.policy'
import { PaymentPolicy } from '@/modules/billing/domain/payment.policy'
import { RequestContext } from '@/shared/context/request-context'
import { todayIso } from '@/shared/dates/calendar-date'
import { compareMoney } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { BillingReferences } from '../billing-references'
import { DepositReturnView, toDepositReturnView } from '../deposit-return.views'
import { PaymentConfirmedEvent } from '../events/payment-events'
import { InstallmentRecalculator } from '../installment-recalculator'
import { RegisterDepositReturnCommand } from './billing.commands'

/**
 * Devolver el depósito (Fase 12, 2.2; Micaela #1; A-13 cerrado). Sólo al
 * cerrar las cuentas del contrato y una sola vez. Cada deducción `DEBT` con
 * cuota se cobra con el depósito: nace un pago `DEPOSIT` sobre la cuota
 * (recibido por la inmobiliaria, confirmado) imputado con el orden por
 * defecto, así la cuenta corriente y la liquidación lo ven como cualquier
 * cobro. Todo en una transacción (D-52). El monto a devolver sale del modo del
 * contrato, no del depósito recibido (D-227).
 */
@CommandHandler(RegisterDepositReturnCommand)
export class RegisterDepositReturnHandler implements ICommandHandler<
  RegisterDepositReturnCommand,
  DepositReturnView
> {
  constructor(
    private readonly references: BillingReferences,
    private readonly returns: DepositReturnRepository,
    private readonly installments: InstallmentRepository,
    private readonly payments: PaymentRepository,
    private readonly recalculator: InstallmentRecalculator,
    private readonly prisma: PrismaService,
    private readonly users: UsersFacade,
    private readonly eventBus: EventBus,
  ) {}

  async execute(
    command: RegisterDepositReturnCommand,
  ): Promise<DepositReturnView> {
    const today = todayIso()
    const registeredById = RequestContext.userId
    if (!registeredById) {
      throw new Error('Devolución del depósito sin usuario en el contexto')
    }
    const contract = await this.references.requireContract(command.contractId)
    DepositReturnPolicy.assertReturnable(contract, today)
    if (await this.returns.findByContract(contract.id)) {
      throw new DepositReturnExistsException(contract.id)
    }
    const { data } = command
    const returnedAt = DepositReturnPolicy.normalizeReturnedAt(
      data.returnedAt,
      today,
    )
    const { mode, referenceAmount } = DepositReturnPolicy.resolveReference(
      {
        ...contract,
        depositReturnMode: DepositReturnMode[contract.depositReturnMode],
        currency: Currency[contract.currency],
      },
      data.referenceAmount,
    )
    const deductions = DepositReturnPolicy.normalizeDeductions(data.deductions)
    const returnedAmount = DepositReturnPolicy.settle(
      referenceAmount,
      deductions,
      data.returnedAmount === null
        ? null
        : DepositReturnPolicy.normalizeReturnedAmount(data.returnedAmount),
    )
    const notes = InstallmentPolicy.normalizeNotes(data.notes)

    // Falla rápido, antes de abrir la transacción: la suma de las deudas de
    // cada cuota contra lo que debe (alto 6). Antes cada deuda se validaba
    // sola y dos sobre la misma cuota imputaban más alquiler que la base.
    const debtTotals = DepositReturnPolicy.debtsByInstallment(deductions)
    for (const [installmentId, amount] of debtTotals) {
      const installment = await this.installments.findById(installmentId)
      if (!installment) throw new InstallmentNotFoundException(installmentId)
      DepositReturnPolicy.assertDebtFitsInstallment(
        { amount },
        {
          contractId: installment.contractId,
          currency: installment.currency,
          totalDue: InstallmentPolicy.balances(installment, returnedAt)
            .totalDue,
        },
        contract,
      )
    }
    const debts = deductions.map((deduction) => ({
      deduction,
      installmentId:
        deduction.concept === DepositDeductionConcept.DEBT
          ? deduction.installmentId
          : null,
    }))

    const { created, payments } = await this.prisma.transaction(async () => {
      const payments: { payment: Payment; installment: Installment }[] = []
      const lines: (DeductionInput & { paymentId: string | null })[] = []
      for (const { deduction, installmentId } of debts) {
        if (!installmentId) {
          lines.push({ ...deduction, paymentId: null })
          continue
        }
        // Lock y relectura antes de cada imputación: la segunda deuda de la
        // misma cuota se imputa contra lo que dejó la primera, y un pago
        // registrado en paralelo espera (alto 6).
        await this.installments.lockForUpdate(installmentId)
        const installment = await this.installments.findById(installmentId)
        if (!installment) throw new InstallmentNotFoundException(installmentId)
        const payment = await this.payFromDeposit(
          installment,
          deduction.amount,
          returnedAt,
          registeredById,
        )
        const updated = await this.recalculator.recalculate(installment.id)
        payments.push({ payment, installment: updated })
        lines.push({ ...deduction, paymentId: payment.id })
      }
      const created = await this.returns.create({
        contractId: contract.id,
        returnedAt,
        depositAmount: contract.deposit,
        depositCurrency: contract.depositCurrency,
        mode,
        referenceAmount,
        returnedAmount,
        method: data.method,
        notes,
        registeredById,
        deductions: lines,
      })
      return { created, payments }
    })

    for (const { payment, installment } of payments) {
      this.eventBus.publish(
        new PaymentConfirmedEvent(
          payment,
          { ownerId: installment.ownerId, period: installment.period },
          installment.currency,
        ),
      )
    }
    const users = await this.users.describe([registeredById])
    return toDepositReturnView(created, users)
  }

  /** El pago `DEPOSIT`: lo imputa punitorio → alquiler → cargos (A-8). */
  private async payFromDeposit(
    installment: Installment,
    amount: string,
    paidAt: string,
    registeredById: string,
  ): Promise<Payment> {
    const balances = InstallmentPolicy.balances(installment, paidAt)
    const allocation = PaymentPolicy.allocate(amount, balances, null)
    if (compareMoney(allocation.creditGenerated, '0') > 0) {
      // Entre la validación y el lock la cuota recibió otro pago: la deuda
      // ya no entra entera y el excedente no puede quedar perdido.
      throw new InvalidDepositDeductionException(
        `el monto supera lo que debe la cuota (${balances.totalDue})`,
      )
    }
    return this.payments.create({
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
      kind: PaymentKind.CASH_IN,
      method: PaymentMethod.DEPOSIT,
      receivedBy: PaymentReceiver.AGENCY,
      status: PaymentStatus.CONFIRMED,
      ...allocation,
      creditId: null,
      receiptKey: null,
      receiptUrl: null,
      registeredById,
      notes: 'Deuda cubierta con el depósito en garantía',
    })
  }
}
