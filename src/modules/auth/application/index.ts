import { ChangePasswordHandler } from './commands/change-password/change-password.handler'
import { LoginHandler } from './commands/login/login.handler'
import { LogoutAllHandler } from './commands/logout-all/logout-all.handler'
import { LogoutHandler } from './commands/logout/logout.handler'
import { PortalLoginHandler } from './commands/portal-login/portal-login.handler'
import { RefreshTokenHandler } from './commands/refresh-token/refresh-token.handler'
import { CreateUserHandler } from './commands/create-user/create-user.handler'
import { ResetUserPasswordHandler } from './commands/reset-user-password/reset-user-password.handler'
import { SetUserActiveHandler } from './commands/set-user-active/set-user-active.handler'
import { UpdateUserHandler } from './commands/update-user/update-user.handler'
import { GetProfileHandler } from './queries/get-profile/get-profile.handler'
import { GetUserHandler } from './queries/get-user/get-user.handler'
import { ListUsersHandler } from './queries/list-users/list-users.handler'
import { SignInService } from './services/sign-in.service'

export const AuthApplicationServices = [SignInService]

export const AuthCommandHandlers = [
  LoginHandler,
  PortalLoginHandler,
  RefreshTokenHandler,
  LogoutHandler,
  LogoutAllHandler,
  ChangePasswordHandler,
  // Gestión de usuarios internos (/users)
  CreateUserHandler,
  UpdateUserHandler,
  SetUserActiveHandler,
  ResetUserPasswordHandler,
]

export const AuthQueryHandlers = [
  GetProfileHandler,
  ListUsersHandler,
  GetUserHandler,
]
