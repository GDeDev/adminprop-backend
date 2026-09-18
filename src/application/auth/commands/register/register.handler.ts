import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { toPublicUser } from '@/domain/auth/entities/user.entity'
import { AuthErrors } from '@/domain/auth/exceptions/auth.exceptions'
import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { AuthTokenIssuer } from '@/infrastructure/auth/services/auth-token-issuer.service'
import { PasswordService } from '@/infrastructure/auth/services/password.service'
import { createLogger } from '@/shared/logging/root-logger'
import { AuthResult } from '../../results/auth-result'
import { RegisterCommand } from './register.command'

@CommandHandler(RegisterCommand)
export class RegisterHandler implements ICommandHandler<
  RegisterCommand,
  AuthResult
> {
  private readonly logger = createLogger('RegisterHandler')

  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordService: PasswordService,
    private readonly tokenIssuer: AuthTokenIssuer,
  ) {}

  async execute(command: RegisterCommand): Promise<AuthResult> {
    // Chequeo previo para devolver un 409 lindo. La garantía real la da el
    // índice único de la base: si dos registros simultáneos pasan por acá, el
    // segundo falla con P2002 y `PrismaExceptionFilter` lo convierte en 409.
    if (await this.userRepository.existsByEmail(command.email)) {
      throw AuthErrors.emailAlreadyRegistered()
    }

    const passwordHash = await this.passwordService.hash(command.password)

    const user = await this.userRepository.create({
      email: command.email,
      passwordHash,
      firstName: command.firstName,
      lastName: command.lastName,
    })

    const tokens = await this.tokenIssuer.issueNewSession(user, command.context)

    this.logger.info(
      {
        operation: 'auth_register',
        userId: user.id,
      },
      'Usuario registrado',
    )

    return { user: toPublicUser(user), tokens }
  }
}
