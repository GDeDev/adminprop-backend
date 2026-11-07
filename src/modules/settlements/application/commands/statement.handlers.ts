import { CommandHandler, EventBus, ICommandHandler } from '@nestjs/cqrs'

import { OwnersFacade } from '@/modules/owners/public'
import { todayIso } from '@/shared/dates/calendar-date'
import { PrismaService } from '@/shared/prisma/prisma.service'
import {
  isConfirmed,
  OwnerStatement,
  Settlement,
  StatementSendMode,
  StatementStatus,
} from '../../domain/settlement'
import {
  SettlementAlreadyInStatementException,
  SettlementNotConfirmedException,
  SettlementNotFoundException,
  SettlementOwnerMismatchException,
  StatementInvalidOwnerException,
  StatementNotClosedException,
  StatementNotFoundException,
  StatementNotOpenException,
  StatementPeriodTakenException,
} from '../../domain/settlement.exceptions'
import {
  OwnerStatementRepository,
  SettlementRepository,
} from '../../domain/settlement.ports'
import { SettlementPolicy } from '../../domain/settlement.policy'
import { StatementClosedEvent } from '../events/settlement-events'
import { SettlementReferences } from '../settlement-references'
import { OwnerStatementDetailView, StatementViews } from '../statement.views'
import {
  AddStatementSettlementsCommand,
  CloseStatementCommand,
  CreateStatementCommand,
  RemoveStatementSettlementCommand,
  ReopenStatementCommand,
} from './statement.commands'

async function requireStatement(
  statements: OwnerStatementRepository,
  id: string,
): Promise<OwnerStatement> {
  const statement = await statements.findById(id)
  if (!statement) throw new StatementNotFoundException(id)
  return statement
}

function assertOpen(statement: OwnerStatement): void {
  if (statement.status !== StatementStatus.OPEN) {
    throw new StatementNotOpenException(statement.id)
  }
}

/** Crear el consolidado del mes de un propietario (4.7): nace abierto y vacío. */
@CommandHandler(CreateStatementCommand)
export class CreateStatementHandler implements ICommandHandler<
  CreateStatementCommand,
  OwnerStatementDetailView
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly owners: OwnersFacade,
    private readonly views: StatementViews,
  ) {}

  async execute(
    command: CreateStatementCommand,
  ): Promise<OwnerStatementDetailView> {
    const settings = await this.owners.feeSettings(command.ownerId)
    if (!settings) throw new StatementInvalidOwnerException(command.ownerId)
    const period = SettlementPolicy.normalizePeriod(command.period, todayIso())
    const taken = await this.statements.findByOwnerAndPeriod(
      command.ownerId,
      period,
    )
    if (taken) throw new StatementPeriodTakenException(taken.id)
    const created = await this.statements.create({
      ownerId: command.ownerId,
      period,
      sendMode: StatementSendMode[settings.statementSendMode],
    })
    return this.views.detail(created)
  }
}

/**
 * Agregar liquidaciones (4.7): confirmadas o transferidas, del mismo
 * propietario y sin consolidado. Una que ya está en este mismo consolidado
 * se ignora (idempotente).
 */
@CommandHandler(AddStatementSettlementsCommand)
export class AddStatementSettlementsHandler implements ICommandHandler<
  AddStatementSettlementsCommand,
  OwnerStatementDetailView
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: StatementViews,
  ) {}

  async execute(
    command: AddStatementSettlementsCommand,
  ): Promise<OwnerStatementDetailView> {
    const statement = await requireStatement(
      this.statements,
      command.statementId,
    )
    assertOpen(statement)
    const candidates: Settlement[] = []
    for (const id of [...new Set(command.settlementIds)]) {
      const settlement = await this.settlements.findById(id)
      if (!settlement) throw new SettlementNotFoundException(id)
      if (settlement.statementId === statement.id) continue
      if (!isConfirmed(settlement)) {
        throw new SettlementNotConfirmedException(id, settlement.status)
      }
      if (settlement.ownerId !== statement.ownerId) {
        throw new SettlementOwnerMismatchException(id)
      }
      if (settlement.statementId !== null) {
        throw new SettlementAlreadyInStatementException(
          id,
          settlement.statementId,
        )
      }
      candidates.push(settlement)
    }
    const updated = await this.prisma.transaction(async () => {
      for (const settlement of candidates) {
        await this.settlements.update(settlement.id, {
          statementId: statement.id,
        })
      }
      return this.refreshCount(statement.id)
    })
    return this.views.detail(updated)
  }

  private async refreshCount(statementId: string): Promise<OwnerStatement> {
    const members = await this.settlements.listAll({ statementId })
    return this.statements.update(statementId, {
      settlementsCount: members.length,
    })
  }
}

@CommandHandler(RemoveStatementSettlementCommand)
export class RemoveStatementSettlementHandler implements ICommandHandler<
  RemoveStatementSettlementCommand,
  OwnerStatementDetailView
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly views: StatementViews,
  ) {}

  async execute(
    command: RemoveStatementSettlementCommand,
  ): Promise<OwnerStatementDetailView> {
    const statement = await requireStatement(
      this.statements,
      command.statementId,
    )
    assertOpen(statement)
    const settlement = await this.settlements.findById(command.settlementId)
    if (!settlement || settlement.statementId !== statement.id) {
      throw new SettlementNotFoundException(command.settlementId)
    }
    const updated = await this.prisma.transaction(async () => {
      await this.settlements.update(settlement.id, { statementId: null })
      const members = await this.settlements.listAll({
        statementId: statement.id,
      })
      return this.statements.update(statement.id, {
        settlementsCount: members.length,
      })
    })
    return this.views.detail(updated)
  }
}

/**
 * Cerrar (4.7): congela los totales por moneda y el modo de envío (default
 * el del consolidado, que nació con el del propietario) y emite
 * `statement-closed` para el email y el PDF.
 */
@CommandHandler(CloseStatementCommand)
export class CloseStatementHandler implements ICommandHandler<
  CloseStatementCommand,
  OwnerStatementDetailView
> {
  constructor(
    private readonly references: SettlementReferences,
    private readonly statements: OwnerStatementRepository,
    private readonly settlements: SettlementRepository,
    private readonly prisma: PrismaService,
    private readonly eventBus: EventBus,
    private readonly views: StatementViews,
  ) {}

  async execute(
    command: CloseStatementCommand,
  ): Promise<OwnerStatementDetailView> {
    const statement = await requireStatement(
      this.statements,
      command.statementId,
    )
    assertOpen(statement)
    const closedById = this.references.requireUser()
    let members: Settlement[] = []
    const closed = await this.prisma.transaction(async () => {
      members = await this.settlements.listAll({
        statementId: statement.id,
      })
      await this.statements.replaceTotals(
        statement.id,
        SettlementPolicy.statementTotals(members),
      )
      return this.statements.update(statement.id, {
        status: StatementStatus.CLOSED,
        sendMode: command.sendMode ?? statement.sendMode,
        settlementsCount: members.length,
        closedAt: new Date(),
        closedById,
      })
    })
    this.eventBus.publish(new StatementClosedEvent(closed, members))
    return this.views.detail(closed)
  }
}

/** Reabrir (admin): vuelve a OPEN; los totales se calculan en vivo otra vez. */
@CommandHandler(ReopenStatementCommand)
export class ReopenStatementHandler implements ICommandHandler<
  ReopenStatementCommand,
  OwnerStatementDetailView
> {
  constructor(
    private readonly statements: OwnerStatementRepository,
    private readonly prisma: PrismaService,
    private readonly views: StatementViews,
  ) {}

  async execute(
    command: ReopenStatementCommand,
  ): Promise<OwnerStatementDetailView> {
    const statement = await requireStatement(
      this.statements,
      command.statementId,
    )
    if (statement.status !== StatementStatus.CLOSED) {
      throw new StatementNotClosedException(statement.id)
    }
    const reopened = await this.prisma.transaction(async () => {
      await this.statements.replaceTotals(statement.id, [])
      return this.statements.update(statement.id, {
        status: StatementStatus.OPEN,
        closedAt: null,
        closedById: null,
      })
    })
    return this.views.detail(reopened)
  }
}
