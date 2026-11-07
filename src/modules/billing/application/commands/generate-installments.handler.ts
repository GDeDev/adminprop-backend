import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import {
  GenerationResult,
  InstallmentGenerator,
} from '../installment-generator'
import { GenerateInstallmentsCommand } from './billing.commands'

/** Spec 3.1: genera las cuotas del mes, idempotente. */
@CommandHandler(GenerateInstallmentsCommand)
export class GenerateInstallmentsHandler implements ICommandHandler<
  GenerateInstallmentsCommand,
  GenerationResult
> {
  constructor(private readonly generator: InstallmentGenerator) {}

  execute(command: GenerateInstallmentsCommand): Promise<GenerationResult> {
    return this.generator.generate(command.period)
  }
}
