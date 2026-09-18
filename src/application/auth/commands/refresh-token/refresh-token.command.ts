import { SessionContext } from '../../results/auth-result'

export class RefreshTokenCommand {
  constructor(
    public readonly refreshToken: string,
    public readonly context: SessionContext = {},
  ) {}
}
