import { SessionContext } from '../../results/auth-result'

export class LoginCommand {
  constructor(
    public readonly email: string,
    public readonly password: string,
    public readonly context: SessionContext = {},
  ) {}
}
