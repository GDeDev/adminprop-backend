import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'
import { randomUUID } from 'node:crypto'

import { AdvanceExpense } from '@/modules/services/domain/advance-expense'
import { AdvanceExpensePolicy } from '@/modules/services/domain/advance-expense.policy'
import { ExpenseNotFoundException } from '@/modules/services/domain/service.exceptions'
import {
  AdvanceExpenseChanges,
  AdvanceExpenseRepository,
} from '@/modules/services/domain/service.ports'
import { StoragePort } from '@/platform/storage/storage.port'
import { RequestContext } from '@/shared/context/request-context'
import { errorMessage } from '@/shared/core/error-message'
import { createLogger } from '@/shared/logging/root-logger'
import {
  AdvanceExpenseView,
  AdvanceExpenseViews,
} from '../advance-expense.views'
import { ServiceReferences } from '../service-references'
import {
  CreateAdvanceExpenseCommand,
  DeleteAdvanceExpenseCommand,
  UpdateAdvanceExpenseCommand,
} from './advance-expense.commands'

export async function requireExpense(
  expenses: AdvanceExpenseRepository,
  id: string,
): Promise<AdvanceExpense> {
  const expense = await expenses.findById(id)
  if (!expense) throw new ExpenseNotFoundException(id)
  return expense
}

/**
 * Alta (spec 3.2). El contrato existe en cualquier estado (spec 7: uno
 * rescindido puede tener gastos pendientes); el inquilino y, si no viene,
 * la moneda se copian de él. El comprobante es obligatorio y se valida por
 * contenido antes de subirlo (D-67); si guardar la fila falla, el archivo
 * se borra para no dejar huérfanos.
 */
@CommandHandler(CreateAdvanceExpenseCommand)
export class CreateAdvanceExpenseHandler implements ICommandHandler<
  CreateAdvanceExpenseCommand,
  AdvanceExpenseView
> {
  private readonly logger = createLogger('CreateAdvanceExpenseHandler')

  constructor(
    private readonly expenses: AdvanceExpenseRepository,
    private readonly references: ServiceReferences,
    private readonly storage: StoragePort,
    private readonly views: AdvanceExpenseViews,
  ) {}

  async execute(
    command: CreateAdvanceExpenseCommand,
  ): Promise<AdvanceExpenseView> {
    const { data } = command
    const amount = AdvanceExpensePolicy.normalizeAmount(data.amount)
    const expenseDate = AdvanceExpensePolicy.normalizeDate(data.expenseDate)
    const description = AdvanceExpensePolicy.normalizeDescription(
      data.description,
    )
    const receipt = AdvanceExpensePolicy.receiptKind(command.receipt)
    const contract = await this.references.requireContractForExpense(
      command.contractId,
    )
    const registeredById = RequestContext.userId
    if (!registeredById)
      throw new Error('Alta de gasto sin usuario en el contexto')

    const stored = await this.storage.upload(
      command.receipt,
      `advance-expenses/${contract.id}/${randomUUID()}.${receipt.extension}`,
      { contentType: receipt.contentType },
    )
    try {
      const created = await this.expenses.create({
        contractId: contract.id,
        renterId: contract.renterId,
        amount,
        currency: data.currency ?? contract.currency,
        description,
        expenseDate,
        receiptKey: stored.key,
        receiptUrl: stored.url,
        registeredById,
      })
      return this.views.one(created)
    } catch (error) {
      await discard(this.storage, this.logger, stored.key)
      throw error
    }
  }
}

/** Edición (spec 4): monto, descripción y fecha, sólo mientras está pendiente. */
@CommandHandler(UpdateAdvanceExpenseCommand)
export class UpdateAdvanceExpenseHandler implements ICommandHandler<
  UpdateAdvanceExpenseCommand,
  AdvanceExpenseView
> {
  constructor(
    private readonly expenses: AdvanceExpenseRepository,
    private readonly views: AdvanceExpenseViews,
  ) {}

  async execute(
    command: UpdateAdvanceExpenseCommand,
  ): Promise<AdvanceExpenseView> {
    const expense = await requireExpense(this.expenses, command.id)
    AdvanceExpensePolicy.assertMutable(expense)
    const { changes } = command
    const next: AdvanceExpenseChanges = {}
    if (changes.amount !== undefined) {
      next.amount = AdvanceExpensePolicy.normalizeAmount(changes.amount)
    }
    if (changes.description !== undefined) {
      next.description = AdvanceExpensePolicy.normalizeDescription(
        changes.description,
      )
    }
    if (changes.expenseDate !== undefined) {
      next.expenseDate = AdvanceExpensePolicy.normalizeDate(changes.expenseDate)
    }
    const updated = await this.expenses.update(expense.id, next)
    return this.views.one(updated)
  }
}

/**
 * Baja (spec 3.2, sólo admin): borrado lógico, sólo mientras está pendiente
 * (409 si ya se descontó). El comprobante se borra del storage después de
 * marcar la fila; si no se puede, queda huérfano y se avisa en el log.
 */
@CommandHandler(DeleteAdvanceExpenseCommand)
export class DeleteAdvanceExpenseHandler implements ICommandHandler<
  DeleteAdvanceExpenseCommand,
  void
> {
  private readonly logger = createLogger('DeleteAdvanceExpenseHandler')

  constructor(
    private readonly expenses: AdvanceExpenseRepository,
    private readonly storage: StoragePort,
  ) {}

  async execute(command: DeleteAdvanceExpenseCommand): Promise<void> {
    const expense = await requireExpense(this.expenses, command.id)
    AdvanceExpensePolicy.assertMutable(expense)
    await this.expenses.delete(expense.id)
    await discard(this.storage, this.logger, expense.receiptKey)
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
      'No se pudo borrar el comprobante de un gasto adelantado',
    )
  }
}
