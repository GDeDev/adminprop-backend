import { addMoney, formatMoney } from '@/shared/money'

/** Lo que el armado de variables necesita saber de la inmobiliaria. */
export interface AgencyContext {
  name: string
  whatsapp: string | null
  phone: string | null
  portalUrl: string
}

const text = (value: unknown): string | undefined =>
  value === null || value === undefined || value === ''
    ? undefined
    : String(value)

/** `2026-11-10` o `2026-11-10T..` a `10/11/2026`; lo que no es fecha pasa igual. */
export function formatDateText(value: unknown): string | undefined {
  const raw = text(value)
  const match = raw ? /^(\d{4})-(\d{2})-(\d{2})/.exec(raw) : null
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw
}

/** `2026-11` a `11/2026`. */
export function formatPeriodText(value: unknown): string | undefined {
  const raw = text(value)
  const match = raw ? /^(\d{4})-(\d{2})$/.exec(raw) : null
  return match ? `${match[2]}/${match[1]}` : raw
}

function money(value: unknown, currency: string): string | undefined {
  const raw = text(value)
  if (!raw) return undefined
  try {
    return formatMoney(raw, currency)
  } catch {
    return undefined
  }
}

/**
 * Normaliza el `data` que mandan los jobs (cada uno con sus nombres) a las
 * variables de las plantillas (REDISENO_FASE_14, 3.2). Los montos llegan como
 * string decimal y se formatean por texto, nunca con `number`.
 */
export function buildTemplateVariables(
  data: Record<string, unknown>,
  recipientName: string | undefined,
  agency: AgencyContext,
): Record<string, string | undefined> {
  const currency = text(data.currency) ?? 'ARS'
  const amountSource =
    data.amount ?? data.rentBalance ?? data.totalDue ?? data.netAmount
  return {
    recipientName,
    propertyAddress: text(data.propertyAddress),
    amount: money(amountSource, currency),
    currency,
    period: formatPeriodText(data.period),
    daysOverdue: text(data.daysOverdue),
    dueDate: formatDateText(
      data.dueDate ??
        data.lastDayWithoutLateFee ??
        data.policyExpiresAt ??
        data.endDate,
    ),
    lateFeeAmount: money(data.lateFeeBalance ?? data.lateFeeAmount, currency),
    agencyName: agency.name,
    agencyWhatsapp: agency.whatsapp ?? agency.phone ?? undefined,
    portalUrl: agency.portalUrl,
    policyNumber: text(data.policyNumber),
    renterName: text(data.renterName),
    renterNationalId: text(data.renterNationalId),
  }
}

/** A quién se le habla en el saludo, según quién recibe. */
export function recipientNameOf(
  kind: string,
  data: Record<string, unknown>,
): string | undefined {
  const explicit = text(data.recipientName)
  if (explicit) return explicit
  switch (kind) {
    case 'RENTER':
      return text(data.renterName)
    case 'OWNER':
      return text(data.ownerName)
    case 'INSURER':
      return text(data.insurerName)
    default:
      return undefined
  }
}

/** Suma de importes decimales como string (el recibo suma tres imputaciones). */
export function sumAmounts(...values: string[]): string {
  return addMoney(...values).toFixed(2)
}
