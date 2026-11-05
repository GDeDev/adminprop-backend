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
  /** Moneda por defecto de la inmobiliaria (precio de publicación, Fase 22). */
  defaultCurrency: 'ARS' | 'USD'
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
  /**
   * Punitorio diario por defecto, en % ("5.00"), desde el día siguiente a la
   * gracia. Null si la inmobiliaria no fijó uno (D-228).
   */
  dailyLateFeePercentage: string | null
  /** Día del mes en que se generan las cuotas del mes siguiente. */
  installmentGenerationDay: number
  /** Aplica solo el saldo a favor del inquilino al generar la cuota (D-237). */
  autoApplyCreditOnGeneration: boolean
  /** Día del mes en que sale el recordatorio de pago. */
  paymentReminderDay: number
  /** Día del mes en que se revisa el cierre de los consolidados a propietarios. */
  monthlyReportDay: number
  // ------------------------------------------------- Datos legales (Fase 15)
  legalName: string | null
  taxId: string | null
  address: string | null
  phone: string | null
  email: string | null
  /** Sólo dígitos con código de país. */
  whatsapp: string | null
  bankAccountHolder: string | null
  bankName: string | null
  bankCbu: string | null
  bankAlias: string | null
  /** Leyenda al pie de los PDFs; sin valor, se usa la fija (A-34). */
  documentFooter: string | null
  /** Clave del logo en el storage (para borrarlo al reemplazarlo). */
  logoKey: string | null
  /** Último número de recibo emitido. */
  receiptSequence: number
}

/** Los campos de `Tenant` que edita el admin desde Configuración (Fase 15). */
export interface TenantSettingsPatch {
  /** Parámetros de cobro (D-228). El punitorio no se puede quitar, sólo cambiar. */
  dailyLateFeePercentage?: string
  paymentGraceDays?: number
  autoApplyCreditOnGeneration?: boolean
  primaryColor?: string | null
  legalName?: string | null
  taxId?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  whatsapp?: string | null
  bankAccountHolder?: string | null
  bankName?: string | null
  bankCbu?: string | null
  bankAlias?: string | null
  documentFooter?: string | null
}
