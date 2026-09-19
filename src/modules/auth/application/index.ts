import { ChangePasswordHandler } from './commands/change-password/change-password.handler'
import { LoginHandler } from './commands/login/login.handler'
import { LogoutAllHandler } from './commands/logout-all/logout-all.handler'
import { LogoutHandler } from './commands/logout/logout.handler'
import { PortalLoginHandler } from './commands/portal-login/portal-login.handler'
import { RefreshTokenHandler } from './commands/refresh-token/refresh-token.handler'
import { GetProfileHandler } from './queries/get-profile/get-profile.handler'
import { SignInService } from './services/sign-in.service'

export const AuthApplicationServices = [SignInService]

export const AuthCommandHandlers = [
  LoginHandler,
  PortalLoginHandler,
  RefreshTokenHandler,
  LogoutHandler,
  LogoutAllHandler,
  ChangePasswordHandler,
]

export const AuthQueryHandlers = [GetProfileHandler]
