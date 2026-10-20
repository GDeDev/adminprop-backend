import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { RequestContext } from '@/shared/context/request-context'
import { AuthResult } from '../../results/auth-result'
import { SignInService } from '../../services/sign-in.service'
import { LoginCommand } from './login.command'

/**
 * Login del backoffice (admin y empleado): email + contraseña, sin decir de
 * qué inmobiliaria. Un propietario o inquilino que lo intente acá recibe el
 * mismo error que un email inexistente: su puerta es `/auth/portal-login`.
 */
@CommandHandler(LoginCommand)
export class LoginHandler implements ICommandHandler<LoginCommand, AuthResult> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly signIn: SignInService,
  ) {}

  async execute(command: LoginCommand): Promise<AuthResult> {
    // Única consulta entre tenants: todavía no sabemos de qué inmobiliaria es.
    const user = await this.userRepository.findInternalByEmail(command.email)

    if (!user) {
      return this.signIn.rejectUnknown(command.password, 'unknown_email')
    }

    // Desde acá todo corre dentro del tenant del usuario.
    return RequestContext.runInTenant(user.tenantId, () =>
      this.signIn.authenticate(user, command.password, command.context),
    )
  }
}
