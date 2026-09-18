import { Provider } from '@nestjs/common'

import { UserRepository } from '@/domain/auth/repositories/user.repository'
import { RefreshTokenRepository } from '@/domain/auth/repositories/refresh-token.repository'
import { UserRepositoryImpl } from './user.repository.impl'
import { RefreshTokenRepositoryImpl } from './refresh-token.repository.impl'

/**
 * Los handlers dependen de los puertos abstractos, no de estas clases: cambiar
 * Prisma por otra cosa es reemplazar estas dos líneas.
 */
export const AuthRepositories: Provider[] = [
  { provide: UserRepository, useClass: UserRepositoryImpl },
  { provide: RefreshTokenRepository, useClass: RefreshTokenRepositoryImpl },
]

export { UserRepositoryImpl, RefreshTokenRepositoryImpl }
