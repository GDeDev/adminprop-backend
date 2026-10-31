import { Injectable } from '@nestjs/common'
import { Prisma } from '@prisma/client'

import { addMonths, periodOf, todayIso } from '@/shared/dates/calendar-date'
import { IndexType } from '../domain/index-value'
import { IndexValuePolicy } from '../domain/index-value.policy'
import { IndexValueRepository } from '../domain/index-value.ports'

/** El último valor cargado de un índice. */
export interface LatestIndexValue {
  period: string
  value: string
  source: string
  createdAt: Date
}

/**
 * Lo que otros módulos pueden preguntarle a índices: el valor de un mes
 * (contratos, al aplicar un aumento ICL/IPC) y, para el job `indices.fetch`
 * de la Fase 13, qué meses faltan y cómo registrar lo que trajo la fuente.
 */
@Injectable()
export class IndicesFacade {
  constructor(private readonly indices: IndexValueRepository) {}

  /** Valor como string decimal, o `null` si ese mes no está cargado. */
  async getValue(indexType: IndexType, period: string): Promise<string | null> {
    const value = await this.indices.find(indexType, period)
    return value?.value ?? null
  }

  /** El mes más reciente cargado, o `null` si no hay ninguno. */
  async latest(indexType: IndexType): Promise<LatestIndexValue | null> {
    const [latest] = await this.indices.listByType(indexType)
    return latest
      ? {
          period: latest.period,
          value: latest.value,
          source: latest.source,
          createdAt: latest.createdAt,
        }
      : null
  }

  /**
   * Los meses sin valor entre los últimos `lastN` meses **terminados** (el
   * mes en curso no tiene su valor todavía), del más viejo al más nuevo.
   */
  async missingPeriods(
    indexType: IndexType,
    lastN: number,
    today = todayIso(),
  ): Promise<string[]> {
    const loaded = new Set(
      (await this.indices.listByType(indexType)).map((v) => v.period),
    )
    const periods: string[] = []
    for (let back = lastN; back >= 1; back -= 1) {
      periods.push(periodOf(addMonths(`${periodOf(today)}-01`, -back)))
    }
    return periods.filter((period) => !loaded.has(period))
  }

  /**
   * Registra el valor que trajo una fuente automática. A diferencia de la
   * carga manual, un mes ya cargado no es un error: no se pisa y devuelve
   * `false` (D-54). `true` si lo creó.
   */
  async registerFromSource(
    indexType: IndexType,
    period: string,
    value: string,
    source: string,
  ): Promise<boolean> {
    const normalizedPeriod = IndexValuePolicy.normalizePeriod(period)
    if (await this.indices.find(indexType, normalizedPeriod)) return false
    try {
      await this.indices.create({
        indexType,
        period: normalizedPeriod,
        value: IndexValuePolicy.normalizeValue(value),
        source,
      })
      return true
    } catch (error) {
      // Dos corridas a la vez: ganó la otra.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return false
      }
      throw error
    }
  }
}
