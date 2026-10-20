import { InternalRole } from '@/modules/auth/domain/enums/role.enum'

export class CreateUserCommand {
  constructor(
    public readonly email: string,
    public readonly firstName: string,
    public readonly lastName: string,
    public readonly role: InternalRole,
    public readonly password: string,
  ) {}
}
