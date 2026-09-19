import { PortalRole } from '@/modules/auth/domain/enums/role.enum'
import { SessionContext } from '../../results/auth-result'

export class PortalLoginCommand {
  constructor(
    /** Inmobiliaria del portal. El front la toma de su configuración o dominio. */
    public readonly tenantSlug: string,
    public readonly email: string,
    public readonly password: string,
    /** Por qué puerta entra: propietario o inquilino. */
    public readonly role: PortalRole,
    public readonly context: SessionContext = {},
  ) {}
}
