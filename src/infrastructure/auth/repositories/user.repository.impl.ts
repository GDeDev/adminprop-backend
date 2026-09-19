import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { PrismaService } from '@/infrastructure/prisma/prisma.service'
import { User } from '@/domain/auth/entities/user.entity'
import { Role } from '@/domain/auth/enums/role.enum'
import {
  CreateUserData,
  UserRepository,
} from '@/domain/auth/repositories/user.repository'

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

  async findByEmail(email: string): Promise<User | null> {
    // Entre tenants a propósito: es cómo el login descubre el tenant.
    const row = await this.prisma.unscoped.user.findUnique({
      where: { email: normalizeEmail(email) },
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

  async existsByEmail(email: string): Promise<boolean> {
    // Global, igual que el índice único de la base.
    const count = await this.prisma.unscoped.user.count({
      where: { email: normalizeEmail(email) },
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
