import { Injectable } from '@nestjs/common'

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

@Injectable()
export class UserRepositoryImpl extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super()
  }

  async findById(id: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({ where: { id } })
    return row ? this.toDomain(row) : null
  }

  async findByEmail(email: string): Promise<User | null> {
    const row = await this.prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
    })
    return row ? this.toDomain(row) : null
  }

  async existsByEmail(email: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { email: normalizeEmail(email) },
    })
    return count > 0
  }

  async create(data: CreateUserData): Promise<User> {
    const row = await this.prisma.user.create({
      data: {
        email: normalizeEmail(data.email),
        passwordHash: data.passwordHash,
        firstName: data.firstName ?? null,
        lastName: data.lastName ?? null,
        role: data.role ?? Role.USER,
      },
    })
    return this.toDomain(row)
  }

  async changePassword(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.user.update({
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
    await this.prisma.user.update({
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
    await this.prisma.$transaction(async (tx) => {
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
    await this.prisma.user.update({
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
  private toDomain(row: {
    id: string
    email: string
    passwordHash: string
    firstName: string | null
    lastName: string | null
    role: string
    isActive: boolean
    failedLoginAttempts: number
    lockedUntil: Date | null
    lastLoginAt: Date | null
    passwordChangedAt: Date | null
    createdAt: Date
    updatedAt: Date
  }): User {
    return {
      id: row.id,
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
