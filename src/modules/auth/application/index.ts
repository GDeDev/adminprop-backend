import { ChangePasswordHandler } from './commands/change-password/change-password.handler'
import { LoginHandler } from './commands/login/login.handler'
import { LogoutAllHandler } from './commands/logout-all/logout-all.handler'
import { LogoutHandler } from './commands/logout/logout.handler'
import { RefreshTokenHandler } from './commands/refresh-token/refresh-token.handler'
import { GetProfileHandler } from './queries/get-profile/get-profile.handler'

export const AuthCommandHandlers = [
  LoginHandler,
  RefreshTokenHandler,
  LogoutHandler,
  LogoutAllHandler,
  ChangePasswordHandler,
]

export const AuthQueryHandlers = [GetProfileHandler]
