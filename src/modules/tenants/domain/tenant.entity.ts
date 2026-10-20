/**
 * Inmobiliaria tal como la ve este módulo: sólo lo que hace falta para
 * identificarla y mostrar su marca. Los parámetros de negocio (honorarios,
 * punitorios, días de corte) se suman cuando una fase los use.
 */
export interface Tenant {
  id: string
  name: string
  slug: string
  logoUrl: string | null
  primaryColor: string | null
  isActive: boolean
  /** Propiedades activas desde las que aplica el honorario reducido (PRD 5.0). */
  reducedFeeThreshold: number
  /** Honorarios de administración estándar, en % ("5.00"). Nunca `number`. */
  standardFeePercentage: string
  /** Honorarios reducidos, en % ("3.00"). */
  reducedFeePercentage: string
  /** Con cuántos días de anticipación un contrato cuenta como "por vencer". */
  contractExpiryNoticeDays: number
  /** Días del mes sin punitorio: del 1 al N (PRD 5.0, RN-02). */
  paymentGraceDays: number
  /** Punitorio diario, en % ("5.00"), desde el día siguiente a la gracia. */
  dailyLateFeePercentage: string
  /** Día del mes en que se generan las cuotas del mes siguiente. */
  installmentGenerationDay: number
  /** Día del mes en que sale el recordatorio de pago. */
  paymentReminderDay: number
}
