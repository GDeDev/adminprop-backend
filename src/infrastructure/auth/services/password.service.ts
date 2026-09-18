import { Injectable, OnModuleInit } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import * as bcrypt from 'bcryptjs'

import { Configuration, JwtConfig } from '@/shared/config/configuration'

/**
 * Límite de bcrypt: ignora todo lo que pase de 72 bytes. Lo cortamos explícito
 * en los DTOs para que nadie crea que una passphrase de 200 caracteres le está
 * sumando entropía.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72

@Injectable()
export class PasswordService implements OnModuleInit {
  private readonly saltRounds: number

  /**
   * Hash descartable contra el que comparamos cuando el email no existe.
   * Sin esto, un login con email inexistente responde mucho más rápido que uno
   * con email válido y contraseña incorrecta, y ese delta permite enumerar
   * cuentas.
   */
  private dummyHash: string

  constructor(
    private readonly configService: ConfigService<Configuration, true>,
  ) {
    const jwt = this.configService.get<JwtConfig>('jwt', { infer: true })
    this.saltRounds = jwt.bcryptSaltRounds
  }

  async onModuleInit(): Promise<void> {
    this.dummyHash = await bcrypt.hash(
      'contrasena-descartable-para-igualar-tiempos',
      this.saltRounds,
    )
  }

  async hash(plainPassword: string): Promise<string> {
    return bcrypt.hash(plainPassword, this.saltRounds)
  }

  async compare(plainPassword: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plainPassword, hash)
  }

  /**
   * Consume el mismo tiempo que un `compare()` real. Llamalo cuando el usuario
   * no existe, así el login tarda lo mismo exista o no la cuenta.
   */
  async burnCompare(plainPassword: string): Promise<void> {
    await bcrypt.compare(plainPassword, this.dummyHash)
  }

  /**
   * Indica si un hash quedó viejo respecto del costo configurado. Sirve para
   * re-hashear en el próximo login exitoso cuando subís `BCRYPT_SALT_ROUNDS`.
   */
  needsRehash(hash: string): boolean {
    const rounds = bcrypt.getRounds(hash)
    return rounds < this.saltRounds
  }
}
