import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { CreateExampleCommand } from './create-example.command'
import { Result } from '@/shared/core/result'
import { Example } from '@/domain/feature/entities/example.entity'
import { Validate } from '@/shared/core/validate'
import { ExampleRepository } from '@/infrastructure/example/repositories/example.repository'
import { CustomLoggerService } from '@/shared/core/logger.service'

export type CreateExampleResult = Result<{ id: string }, string>

@CommandHandler(CreateExampleCommand)
export class CreateExampleHandler implements ICommandHandler<CreateExampleCommand> {
  private readonly logger = new CustomLoggerService(CreateExampleHandler.name)

  constructor(private readonly exampleRepository: ExampleRepository) {}

  async execute(command: CreateExampleCommand): Promise<CreateExampleResult> {
    const startTime = Date.now()
    this.logger.log('Executing CreateExampleCommand', {
      operation: 'command_start',
      commandName: 'CreateExampleCommand',
      inputData: command.data,
    })

    try {
      const validate = this.validate(command)
      if (validate.isFailure) {
        this.logger.warn('Command validation failed', {
          operation: 'validation_failed',
          commandName: 'CreateExampleCommand',
          validationError: validate.getErrorValue(),
          inputData: command.data,
        })
        return Result.fail(validate.getErrorValue())
      }

      const { data } = command
      const example = new Example(data.name)

      // Save through repository
      await this.exampleRepository.create(example)
      const duration = Date.now() - startTime

      this.logger.logCommandExecution('CreateExampleCommand', duration, true, {
        entityType: 'Example',
        entityName: data.name,
      })

      this.logger.logBusinessOperation(
        'example_created',
        undefined,
        undefined,
        {
          exampleName: data.name,
          createdAt: new Date().toISOString(),
        },
      )

      return Result.ok({
        id: 'generated-id', // TODO: Replace with actual ID from example
      })
    } catch (error) {
      const duration = Date.now() - startTime
      this.logger.logCommandExecution('CreateExampleCommand', duration, false, {
        errorName: error.name,
        errorMessage: error.message,
        inputData: command.data,
      })

      return Result.fail(error.message)
    }
  }

  private validate(command: CreateExampleCommand) {
    const validation = Validate.isRequiredBulk([
      { argument: command.data.name, argumentName: 'name' },
    ])

    if (!validation.success) {
      return Result.fail<string>(validation.message)
    }

    return Result.ok()
  }
}
