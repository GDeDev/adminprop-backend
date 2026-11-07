import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { MANUAL_SOURCE } from '@/modules/indices/domain/index-value'
import { IndexPeriodTakenException } from '@/modules/indices/domain/index-value.exceptions'
import { IndexValuePolicy } from '@/modules/indices/domain/index-value.policy'
import { IndexValueRepository } from '@/modules/indices/domain/index-value.ports'
import { IndexValueView, toIndexValueView } from '../index-value.view'
import { RegisterIndexValueCommand } from './register-index-value.command'

/**
 * Carga manual de un valor (spec Fase 9, 3.8). Un período ya cargado no se
 * pisa: el valor publicado es uno solo, y los contratos que ya lo usaron
 * guardan el que vieron. Si una carga manual estuvo mal, se corrige en la
 * base con registro, no por la API.
 */
@CommandHandler(RegisterIndexValueCommand)
export class RegisterIndexValueHandler implements ICommandHandler<
  RegisterIndexValueCommand,
  IndexValueView
> {
  constructor(private readonly indices: IndexValueRepository) {}

  async execute(command: RegisterIndexValueCommand): Promise<IndexValueView> {
    const period = IndexValuePolicy.normalizePeriod(command.period)
    const value = IndexValuePolicy.normalizeValue(command.value)

    // Chequeo previo al índice único, para dar un error con nombre propio.
    if (await this.indices.find(command.indexType, period)) {
      throw new IndexPeriodTakenException(command.indexType, period)
    }

    const created = await this.indices.create({
      indexType: command.indexType,
      period,
      value,
      source: MANUAL_SOURCE,
    })
    return toIndexValueView(created)
  }
}
