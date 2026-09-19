import { UpdateUserData } from '@/modules/auth/domain/repositories/user.repository'

export class UpdateUserCommand {
  constructor(
    /** El admin que edita: no puede cambiarse su propio rol. */
    public readonly actorId: string,
    public readonly userId: string,
    public readonly changes: UpdateUserData,
  ) {}
}
