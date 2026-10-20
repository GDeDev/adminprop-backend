import { Injectable } from '@nestjs/common'

import { UserRepository } from '../domain/repositories/user.repository'

/** Lo justo para mostrar quién hizo algo desde otro módulo. */
export interface UserRef {
  id: string
  /** Nombre y apellido; si el usuario no los tiene cargados, su email. */
  fullName: string
}

/**
 * Lectura de usuarios para otros módulos (quién registró un gasto, quién
 * cobró). Sólo nombres: nada de roles, estado ni credenciales. Corre dentro
 * del tenant del contexto.
 */
@Injectable()
export class UsersFacade {
  constructor(private readonly users: UserRepository) {}

  /** Nombre de cada uno, en una sola consulta. Los borrados no aparecen. */
  async describe(ids: string[]): Promise<Map<string, UserRef>> {
    const users = await this.users.findByIds([...new Set(ids)])
    return new Map(
      users.map((user) => [
        user.id,
        {
          id: user.id,
          fullName:
            [user.firstName, user.lastName].filter(Boolean).join(' ') ||
            user.email,
        },
      ]),
    )
  }
}
