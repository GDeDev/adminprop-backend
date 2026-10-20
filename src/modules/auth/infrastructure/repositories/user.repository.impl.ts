import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '@/shared/prisma/prisma.service'
import { User } from '@/modules/auth/domain/entities/user.entity'
import {
  INTERNAL_ROLES,
  PortalRole,
  Role,
} from '@/modules/auth/domain/enums/role.enum'
import {
  CreateUserData,
  InternalUserFilter,
  UpdateUserData,
  UserRepository,
} from '@/modules/auth/domain/repositories/user.repository'
import { PageArgs } from '@/shared/pagination/pagination'

/** Normaliza el email para que el unique de la base sea case-insensitive. */
export const normalizeEmail = (email: string): string =>
  email.trim().toLowerCase()

/** El tenant se trae junto con el usuario para saber si está habilitado. */
const WITH_TENANT = { tenant: { select: { isActive: true } } } as const

type UserRow = Prisma.UserGetPayload<{ include: typeof WITH_TENANT }>

@Injectable()
export class UserRepositoryImpl extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.db.user.findUnique({
      where: { id },
      include: WITH_TENANT,
    })
    return row ? this.toDomain(row) : null
  }

  async findInternalByEmail(email: string): Promise<User | null> {
    // Entre tenants a propósito: es cómo el login descubre el tenant. El
    // índice único parcial garantiza que hay a lo sumo uno.
    const row = await this.prisma.unscoped.user.findFirst({
      where: {
        email: normalizeEmail(email),
        role: { in: [...INTERNAL_ROLES] },
      },
      include: WITH_TENANT,
    })
    return row ? this.toDomain(row) : null
  }

  async findPortalUser(email: string, role: PortalRole): Promise<User | null> {
    // Dentro del tenant del contexto: el mismo email puede existir en otra
    // inmobiliaria, y esa no es asunto de este login.
    const row = await this.prisma.db.user.findFirst({
      where: { email: normalizeEmail(email), role },
      include: WITH_TENANT,
    })
    return row ? this.toDomain(row) : null
  }

  async findByIdForSession(id: string): Promise<User | null> {
    // Entre tenants a propósito: el refresh token no lleva el tenant.
    const row = await this.prisma.unscoped.user.findUnique({
      where: { id },
      include: WITH_TENANT,
    })
    return row ? this.toDomain(row) : null
  }

  async existsInternalByEmail(
    email: string,
    exceptId?: string,
  ): Promise<boolean> {
    // Global, igual que el índice único de la base.
    const count = await this.prisma.unscoped.user.count({
      where: {
        email: normalizeEmail(email),
        role: { in: [...INTERNAL_ROLES] },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
    })
    return count > 0
  }

  async create(data: CreateUserData): Promise<User> {
    // Sin tenantId: lo completa el filtro de tenant con el del contexto. El
    // cast es porque el tipo de Prisma no sabe que la extensión lo agrega.
    const row = await this.prisma.db.user.create({
      data: {
        email: normalizeEmail(data.email),
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        role: data.role,
      } as Prisma.UserUncheckedCreateInput,
      include: WITH_TENANT,
    })
    return this.toDomain(row)
  }

  async listInternal(
    filter: InternalUserFilter,
    page: PageArgs,
  ): Promise<[User[], number]> {
    const where: Prisma.UserWhereInput = {
      role: filter.role ?? { in: [...INTERNAL_ROLES] },
      ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
    }

    // En una transacción para que la página y el total vean el mismo estado.
    const [rows, total] = await this.prisma.db.$transaction([
      this.prisma.db.user.findMany({
        where,
        include: WITH_TENANT,
        orderBy: [
          { lastName: { sort: 'asc', nulls: 'last' } },
          { firstName: { sort: 'asc', nulls: 'last' } },
          { email: 'asc' },
        ],
        ...page,
      }),
      this.prisma.db.user.count({ where }),
    ])

    return [rows.map((row) => this.toDomain(row)), total]
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    const row = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...data,
        ...(data.email === undefined
          ? {}
          : { email: normalizeEmail(data.email) }),
      },
      include: WITH_TENANT,
    })
    return this.toDomain(row)
  }

  async setActive(id: string, isActive: boolean): Promise<User> {
    const row = await this.prisma.db.user.update({
      where: { id },
      data: { isActive },
      include: WITH_TENANT,
    })
    return this.toDomain(row)
  }

  async changePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    })
  }

  async rehashPassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: { passwordHash },
    })
  }

  async registerFailedLogin(
    userId: string,
    maxAttempts: number,
    lockDurationMs: number,
  ): Promise<void> {
    // El incremento va en una transacción para que dos intentos simultáneos no
    // se pisen el contador (read-modify-write).
    await this.prisma.db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { failedLoginAttempts: true },
      })

      if (!user) return

      const attempts = user.failedLoginAttempts + 1
      const shouldLock = attempts >= maxAttempts

      await tx.user.update({
        where: { id: userId },
        data: {
          failedLoginAttempts: shouldLock ? 0 : attempts,
          lockedUntil: shouldLock
            ? new Date(Date.now() + lockDurationMs)
            : undefined,
        },
      })
    })
  }

  async registerSuccessfulLogin(userId: string): Promise<void> {
    await this.prisma.db.user.update({
      where: { id: userId },
      data: {
        failedLoginAttempts: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
      },
    })
  }

  /**
   * Mapea la fila de Prisma al tipo de dominio.
   * Si algún día `role` pasa a ser una relación muchos-a-muchos, este es el
   * único lugar que hay que tocar.
   */
  private toDomain(row: UserRow): User {
    return {
      id: row.id,
      tenantId: row.tenantId,
      tenantIsActive: row.tenant.isActive,
      email: row.email,
      passwordHash: row.passwordHash,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role as Role,
      isActive: row.isActive,
      failedLoginAttempts: row.failedLoginAttempts,
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      passwordChangedAt: row.passwordChangedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }
  }
}
