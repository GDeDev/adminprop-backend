import { CommandHandler, ICommandHandler } from '@nestjs/cqrs'

import { UserRepository } from '@/modules/auth/domain/repositories/user.repository'
import { TenantsFacade } from '@/modules/tenants/public'
import { RequestContext } from '@/shared/context/request-context'
import { AuthResult } from '../../results/auth-result'
import { SignInService } from '../../services/sign-in.service'
import { PortalLoginCommand } from './portal-login.command'

/**
 * Login del portal de propietarios e inquilinos (spec Fase 4, 3.2).
 *
 * A diferencia del backoffice, el email no alcanza para saber quién es: la
 * misma persona puede ser propietaria en dos inmobiliarias. Por eso el portal
 * manda la inmobiliaria (su slug) y el usuario se busca sólo dentro de ella.
 * Un propietario de una inmobiliaria nunca entra "cruzado" a otra.
 *
 * Inmobiliaria inexistente, deshabilitada, email desconocido o rol distinto:
 * todo responde el mismo 401 genérico, con el mismo tiempo de bcrypt.
 */
@CommandHandler(PortalLoginCommand)
export class PortalLoginHandler implements ICommandHandler<
  PortalLoginCommand,
  AuthResult
> {
  constructor(
    private readonly tenants: TenantsFacade,
    private readonly userRepository: UserRepository,
    private readonly signIn: SignInService,
  ) {}

  async execute(command: PortalLoginCommand): Promise<AuthResult> {
    const tenantId = await this.tenants.findActiveIdBySlug(command.tenantSlug)

    if (!tenantId) {
      return this.signIn.rejectUnknown(command.password, 'unknown_tenant', {
        tenantSlug: command.tenantSlug,
      })
    }

    return RequestContext.runInTenant(tenantId, async () => {
      const user = await this.userRepository.findPortalUser(
        command.email,
        command.role,
      )

      if (!user) {
        return this.signIn.rejectUnknown(command.password, 'unknown_email', {
          portalRole: command.role,
        })
      }

      return this.signIn.authenticate(user, command.password, command.context)
    })
  }
}
