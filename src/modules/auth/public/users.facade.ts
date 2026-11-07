import { Injectable } from '@nestjs/common'

import { UserRepository } from '../domain/repositories/user.repository'

/** Lo justo para mostrar quién hizo algo desde otro módulo. */
export interface UserRef {
  id: string
  /** Nombre y apellido; si el usuario no los tiene cargados, su email. */
  fullName: string
}

/** Una persona del personal con la que se puede contactar (Fase 14). */
export interface StaffContact {
  userId: string
  email: string
  role: 'ADMIN' | 'EMPLOYEE'
  fullName: string
}

/** Tope de personal por inmobiliaria que se recorre para avisar. */
const STAFF_LIMIT = 200

/**
 * Lectura de usuarios para otros módulos (quién registró un gasto, quién
 * cobró). Sólo nombres: nada de roles, estado ni credenciales. Corre dentro
 * del tenant del contexto.
 */
@Injectable()
export class UsersFacade {
  constructor(private readonly users: UserRepository) {}

  /**
   * Admins y empleados activos de la inmobiliaria del contexto, para mandarles
   * un aviso a cada uno (Fase 14). Los inactivos y los borrados no aparecen.
   */
  async listStaffContacts(): Promise<StaffContact[]> {
    const [users] = await this.users.listInternal(
      { isActive: true },
      { skip: 0, take: STAFF_LIMIT },
    )
    return users.map((user) => ({
      userId: user.id,
      email: user.email,
      role: user.role as 'ADMIN' | 'EMPLOYEE',
      fullName:
        [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
    }))
  }

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
