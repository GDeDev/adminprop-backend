import {
  CARD_MESSAGE_LENGTH,
  CLOSED_STAGES,
  Inquiry,
  InquiryStage,
} from './inquiry'

/** Separación entre posiciones al insertar al final o al principio. */
export const POSITION_STEP = 1000
/** Por debajo de esta diferencia entre vecinos se renumera la columna (A-82). */
export const MIN_POSITION_GAP = 1e-6

export interface StageChange {
  stage: InquiryStage
  stageChangedAt: Date
  lastContactAt: Date | null
  lostReason: string | null
  closedAt: Date | null
  contractId: string | null
}

/** Reglas puras del CRM (Fase 23, 4). */
export const InquiryPolicy = {
  isClosed(stage: InquiryStage): boolean {
    return CLOSED_STAGES.includes(stage)
  },

  /** Al menos un medio de contacto, ignorando espacios. */
  hasContact(
    email: string | null | undefined,
    phone: string | null | undefined,
  ) {
    return Boolean(email?.trim() || phone?.trim())
  },

  /** `CLOSED_LOST` exige un motivo no vacío. */
  lostReasonMissing(stage: InquiryStage, lostReason?: string | null): boolean {
    return stage === InquiryStage.CLOSED_LOST && !lostReason?.trim()
  },

  /**
   * Los campos que cambian al pasar de columna: salir de `NEW` fija el primer
   * contacto; cerrar guarda el cierre; reabrir limpia el cierre.
   */
  applyStage(
    current: Pick<
      Inquiry,
      'stage' | 'lastContactAt' | 'lostReason' | 'closedAt' | 'contractId'
    >,
    target: InquiryStage,
    now: Date,
    extra: { lostReason?: string | null; contractId?: string | null } = {},
  ): StageChange {
    const closing = InquiryPolicy.isClosed(target)
    return {
      stage: target,
      stageChangedAt: now,
      lastContactAt:
        current.lastContactAt ??
        (current.stage === InquiryStage.NEW && target !== InquiryStage.NEW
          ? now
          : null),
      lostReason:
        target === InquiryStage.CLOSED_LOST
          ? (extra.lostReason?.trim() ?? null)
          : null,
      closedAt: closing ? now : null,
      contractId:
        target === InquiryStage.CLOSED_WON ? (extra.contractId ?? null) : null,
    }
  },

  /**
   * Posición entre dos vecinos de la columna de destino (A-82). `before` es
   * la tarjeta que queda arriba y `after` la que queda abajo; ambas son
   * posiciones ya ordenadas. Devuelve null si no hay lugar y hay que
   * renumerar la columna.
   */
  positionBetween(before: number | null, after: number | null): number | null {
    if (before === null && after === null) return POSITION_STEP
    if (before === null) return (after as number) - POSITION_STEP
    if (after === null) return before + POSITION_STEP
    if (after - before < MIN_POSITION_GAP * 2) return null
    return (before + after) / 2
  },

  /** Posiciones 1000, 2000... para renumerar una columna sin cambiar su orden. */
  renumber(count: number): number[] {
    return Array.from({ length: count }, (_, i) => (i + 1) * POSITION_STEP)
  },

  /** Primeros 140 caracteres, sin cortar a la fuerza un espacio final. */
  excerpt(message: string): string {
    return message.length <= CARD_MESSAGE_LENGTH
      ? message
      : message.slice(0, CARD_MESSAGE_LENGTH)
  },

  ageHours(createdAt: Date, now: Date): number {
    return Math.max(
      0,
      Math.floor((now.getTime() - createdAt.getTime()) / 3_600_000),
    )
  },

  /** `CLOSED_WON / total` con un decimal ("12.5"), o null sin consultas. */
  conversionRate(won: number, total: number): string | null {
    if (total === 0) return null
    return ((won / total) * 100).toFixed(1)
  },

  /** Horas promedio entre la llegada y el primer contacto; null sin datos. */
  averageHours(deltasMs: number[]): number | null {
    if (deltasMs.length === 0) return null
    const mean = deltasMs.reduce((a, b) => a + b, 0) / deltasMs.length
    return Math.round((mean / 3_600_000) * 10) / 10
  },
}
