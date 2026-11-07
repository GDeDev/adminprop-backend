import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { ContractsFacade } from '@/modules/contracts/public'
import { OwnersFacade } from '@/modules/owners/public'
import { StoragePort } from '@/platform/storage/storage.port'
import { errorMessage } from '@/shared/core/error-message'
import { todayIso } from '@/shared/dates/calendar-date'
import { createLogger } from '@/shared/logging/root-logger'
import { compareMoney, subtractMoney, toMoneyString } from '@/shared/money'
import { PrismaService } from '@/shared/prisma/prisma.service'
import { FeePolicy } from '../../domain/fee.policy'
import {
  Currency,
  FeePayment,
  FeeReceivableStatus,
} from '../../domain/settlement'
import {
  FeePaymentAlreadyVoidedException,
  FeePaymentInvalidContractException,
  FeePaymentInvalidOwnerException,
  FeePaymentNotFoundException,
} from '../../domain/settlement.exceptions'
import {
  FeePaymentRepository,
  FeeReceivableRepository,
} from '../../domain/settlement.ports'
import { SettlementPolicy } from '../../domain/settlement.policy'
import { FeeAccountService } from '../fee-account.service'
import { FeePaymentView, FeeViews } from '../fee.views'
import { SettlementReferences } from '../settlement-references'
import {
  AllocateFeePaymentCommand,
  RegisterFeePaymentCommand,
  VoidFeePaymentCommand,
} from './statement.commands'

/**
 * Imputa lo que un pago tiene sin asignar a los receivables pendientes del
 * propietario (y del contrato, si el pago vino con uno) en su moneda, de los
 * más viejos a los más nuevos (3.3). Devuelve el pago actualizado.
 */
async function allocatePayment(
  deps: {
    receivables: FeeReceivableRepository
    payments: FeePaymentRepository
    fees: FeeAccountService
  },
  payment: FeePayment,
): Promise<FeePayment> {
  if (compareMoney(payment.unallocatedAmount, '0') <= 0) return payment
  const pending = await deps.receivables.listAll({
    ownerId: payment.ownerId,
    contractId: payment.contractId ?? undefined,
    currency: payment.currency,
    statuses: [FeeReceivableStatus.PENDING, FeeReceivableStatus.PARTIAL],
  })
  const { allocations, unallocated } = FeePolicy.allocate(
    payment.unallocatedAmount,
    pending,
  )
  if (allocations.length === 0) return payment
  await deps.payments.addAllocations(
    payment.id,
    allocations.map((a) => ({
      feeReceivableId: a.receivableId,
      amount: a.amount,
    })),
  )
  for (const allocation of allocations) {
    const receivable = pending.find((r) => r.id === allocation.receivableId)
    if (receivable) {
      await deps.fees.applyToReceivable(receivable, allocation.amount)
    }
  }
  return deps.payments.update(payment.id, { unallocatedAmount: unallocated })
}

/**
 * Registrar un pago de honorarios (4.8): lo paga el propietario o el
 * inquilino por su cuenta; se imputa a los receivables más viejos y el
 * exceso queda sin imputar para los futuros. El comprobante se sube antes
 * y se borra si la transacción falla.
 */
@CommandHandler(RegisterFeePaymentCommand)
export class RegisterFeePaymentHandler implements ICommandHandler<
  RegisterFeePaymentCommand,
  FeePaymentView
> {
  private readonly logger = createLogger('RegisterFeePaymentHandler')

  constructor(
    private readonly references: SettlementReferences,
    private readonly owners: OwnersFacade,
    private readonly contracts: ContractsFacade,
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
    private readonly fees: FeeAccountService,
    private readonly storage: StoragePort,
    private readonly prisma: PrismaService,
    private readonly views: FeeViews,
  ) {}

  async execute(command: RegisterFeePaymentCommand): Promise<FeePaymentView> {
    const { data } = command
    if (!(await this.owners.exists(data.ownerId))) {
      throw new FeePaymentInvalidOwnerException(data.ownerId)
    }
    if (data.contractId) {
      const contract = await this.contracts.find(data.contractId)
      if (!contract || contract.ownerId !== data.ownerId) {
        throw new FeePaymentInvalidContractException(data.contractId)
      }
    }
    const amount = FeePolicy.normalizeAmount(data.amount)
    const paidAt = SettlementPolicy.normalizeDate(
      data.paidAt,
      todayIso(),
      'paidAt',
    )
    const receipt = SettlementPolicy.receiptKind(command.receipt)
    const notes = SettlementPolicy.normalizeNotes(data.notes)
    const registeredById = this.references.requireUser()

    const stored = receipt
      ? await this.storage.upload(
          command.receipt,
          `fee-payments/${data.ownerId}/${randomUUID()}.${receipt.extension}`,
          { contentType: receipt.contentType, access: 'private' },
        )
      : null
    try {
      const payment = await this.prisma.transaction(async () => {
        const created = await this.payments.create({
          ownerId: data.ownerId,
          contractId: data.contractId,
          paidAt,
          amount,
          currency: Currency[data.currency as keyof typeof Currency],
          method: data.method,
          paidBy: data.paidBy,
          unallocatedAmount: amount,
          receiptKey: stored?.key ?? null,
          receiptUrl: stored?.url ?? null,
          notes,
          registeredById,
          allocations: [],
        })
        return allocatePayment(
          {
            receivables: this.receivables,
            payments: this.payments,
            fees: this.fees,
          },
          created,
        )
      })
      return this.views.payment(payment)
    } catch (error) {
      if (stored) {
        try {
          await this.storage.delete(stored.key)
        } catch (cleanupError) {
          this.logger.warn(
            { key: stored.key, error: errorMessage(cleanupError) },
            'No se pudo borrar el comprobante de un pago de honorarios que no se guardó',
          )
        }
      }
      throw error
    }
  }
}

/** Anular un pago de honorarios (admin): deshace sus imputaciones. */
@CommandHandler(VoidFeePaymentCommand)
export class VoidFeePaymentHandler implements ICommandHandler<
  VoidFeePaymentCommand,
  FeePaymentView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
    private readonly prisma: PrismaService,
    private readonly views: FeeViews,
  ) {}

  async execute(command: VoidFeePaymentCommand): Promise<FeePaymentView> {
    const payment = await this.payments.findById(command.paymentId)
    if (!payment) throw new FeePaymentNotFoundException(command.paymentId)
    if (payment.voidedAt !== null) {
      throw new FeePaymentAlreadyVoidedException(payment.id)
    }
    const voidReason = SettlementPolicy.normalizeReason(command.reason)
    const voidedById = this.references.requireUser()
    const voided = await this.prisma.transaction(async () => {
      for (const allocation of payment.allocations) {
        const receivable = await this.receivables.findById(
          allocation.feeReceivableId,
        )
        if (!receivable) continue
        const paidAmount = toMoneyString(
          subtractMoney(receivable.paidAmount, allocation.amount),
        )
        await this.receivables.update(receivable.id, {
          paidAmount,
          status:
            receivable.status === FeeReceivableStatus.VOIDED
              ? FeeReceivableStatus.VOIDED
              : FeePolicy.receivableStatus(receivable.amount, paidAmount),
        })
      }
      return this.payments.update(payment.id, {
        unallocatedAmount: toMoneyString('0'),
        voidedAt: new Date(),
        voidedById,
        voidReason,
      })
    })
    return this.views.payment(voided)
  }
}

/** `POST /fee-payments/:id/allocate`: aplica el saldo sin imputar a lo pendiente de hoy. */
@CommandHandler(AllocateFeePaymentCommand)
export class AllocateFeePaymentHandler implements ICommandHandler<
  AllocateFeePaymentCommand,
  FeePaymentView
> {
  constructor(
    private readonly receivables: FeeReceivableRepository,
    private readonly payments: FeePaymentRepository,
    private readonly fees: FeeAccountService,
    private readonly prisma: PrismaService,
    private readonly views: FeeViews,
  ) {}

  async execute(command: AllocateFeePaymentCommand): Promise<FeePaymentView> {
    const payment = await this.payments.findById(command.paymentId)
    if (!payment) throw new FeePaymentNotFoundException(command.paymentId)
    if (payment.voidedAt !== null) {
      throw new FeePaymentAlreadyVoidedException(payment.id)
    }
    const updated = await this.prisma.transaction(() =>
      allocatePayment(
        {
          receivables: this.receivables,
          payments: this.payments,
          fees: this.fees,
        },
        payment,
      ),
    )
    return this.views.payment(updated)
  }
}
