import { NotificationTypeName } from './notification-catalog'

/**
 * Plantillas de email (REDISENO_FASE_14, 3.2). Una plantilla es un asunto y un
 * texto con variables `{{nombre}}`; el HTML lo arma el layout. Sin lógica en la
 * plantilla: ni condicionales ni bucles. Código puro.
 */
export interface TemplateVariable {
  name: string
  /** Etiqueta en español para el editor. */
  label: string
  example: string
}

export const TEMPLATE_VARIABLES: Record<string, TemplateVariable> = {
  recipientName: {
    name: 'recipientName',
    label: 'Nombre del destinatario',
    example: 'Ana Gómez',
  },
  propertyAddress: {
    name: 'propertyAddress',
    label: 'Dirección de la propiedad',
    example: 'Av. Corrientes 1234, 5° B',
  },
  amount: { name: 'amount', label: 'Monto', example: '$ 125.000,00' },
  currency: { name: 'currency', label: 'Moneda', example: 'ARS' },
  period: { name: 'period', label: 'Período', example: '11/2026' },
  daysOverdue: { name: 'daysOverdue', label: 'Días de mora', example: '12' },
  dueDate: {
    name: 'dueDate',
    label: 'Fecha de vencimiento',
    example: '10/11/2026',
  },
  lateFeeAmount: {
    name: 'lateFeeAmount',
    label: 'Punitorio',
    example: '$ 7.500,00',
  },
  agencyName: {
    name: 'agencyName',
    label: 'Nombre de la inmobiliaria',
    example: 'Oppido Propiedades',
  },
  agencyWhatsapp: {
    name: 'agencyWhatsapp',
    label: 'WhatsApp de la inmobiliaria',
    example: '+54 9 221 555-1234',
  },
  portalUrl: {
    name: 'portalUrl',
    label: 'Link al portal',
    example: 'https://portal.adminprop.com/oppido',
  },
  policyNumber: {
    name: 'policyNumber',
    label: 'Número de póliza',
    example: 'POL-48392',
  },
  renterName: {
    name: 'renterName',
    label: 'Nombre del inquilino',
    example: 'Juan Pérez',
  },
  renterNationalId: {
    name: 'renterNationalId',
    label: 'DNI del inquilino',
    example: '30.123.456',
  },
}

export const ALL_VARIABLE_NAMES = Object.keys(TEMPLATE_VARIABLES)

export interface DefaultTemplate {
  /** Variables que puede usar esta plantilla. */
  variables: string[]
  subject: string
  bodyText: string
}

const COMMON = ['recipientName', 'agencyName', 'agencyWhatsapp', 'portalUrl']

function def(
  extra: string[],
  subject: string,
  bodyText: string,
): DefaultTemplate {
  return { variables: [...COMMON, ...extra], subject, bodyText }
}

/**
 * Textos por defecto, por tipo (la clave completa es `<TIPO>.EMAIL`). Los
 * avisos al personal usan los mismos textos: el nombre y los datos cambian.
 */
export const DEFAULT_EMAIL_TEMPLATES: Partial<
  Record<NotificationTypeName, DefaultTemplate>
> = {
  PAYMENT_REMINDER: def(
    ['propertyAddress', 'amount', 'period', 'dueDate'],
    'Recordatorio de pago - {{period}}',
    `Hola {{recipientName}},

Te recordamos que el alquiler de {{propertyAddress}} correspondiente a {{period}} es de {{amount}}.

Podés abonarlo sin recargo hasta el {{dueDate}}.

Ante cualquier duda escribinos por WhatsApp al {{agencyWhatsapp}}.

Saludos,
{{agencyName}}`,
  ),
  ARREARS_NOTICE: def(
    [
      'propertyAddress',
      'amount',
      'period',
      'daysOverdue',
      'lateFeeAmount',
      'renterName',
    ],
    'Aviso de mora - {{propertyAddress}} ({{period}})',
    `Hola {{recipientName}},

La cuota de {{period}} de {{propertyAddress}} ({{renterName}}) registra {{daysOverdue}} días de atraso.

Saldo de alquiler: {{amount}}.
Punitorio acumulado: {{lateFeeAmount}}.

Te pedimos regularizar el pago a la brevedad. Si ya lo abonaste, avisanos por WhatsApp al {{agencyWhatsapp}}.

Saludos,
{{agencyName}}`,
  ),
  INSURER_ALERT: def(
    [
      'propertyAddress',
      'amount',
      'period',
      'policyNumber',
      'renterName',
      'renterNationalId',
    ],
    'Aviso de incumplimiento - póliza {{policyNumber}}',
    `Estimados {{recipientName}},

Les informamos que el inquilino {{renterName}} (DNI {{renterNationalId}}), titular de la póliza {{policyNumber}}, registra una deuda de alquiler de {{amount}} correspondiente a {{period}} en {{propertyAddress}}.

Quedamos a su disposición para ampliar la información.

Saludos,
{{agencyName}}`,
  ),
  CONTRACT_EXPIRING: def(
    ['propertyAddress', 'dueDate', 'renterName'],
    'Contrato por vencer - {{propertyAddress}}',
    `Hola {{recipientName}},

El contrato de {{propertyAddress}} (inquilino: {{renterName}}) vence el {{dueDate}}.

Escribinos al {{agencyWhatsapp}} para coordinar la renovación o la devolución de la propiedad.

Saludos,
{{agencyName}}`,
  ),
  POLICY_EXPIRING: def(
    ['propertyAddress', 'dueDate', 'policyNumber', 'renterName'],
    'Póliza por vencer - {{propertyAddress}}',
    `Hola {{recipientName}},

La póliza {{policyNumber}} del contrato de {{propertyAddress}} ({{renterName}}) vence el {{dueDate}}.

Hay que pedir la renovación a tiempo para no quedar sin cobertura.

Saludos,
{{agencyName}}`,
  ),
  POLICY_EXPIRED: def(
    ['propertyAddress', 'dueDate', 'policyNumber', 'renterName'],
    'Póliza vencida - {{propertyAddress}}',
    `Hola {{recipientName}},

La póliza {{policyNumber}} del contrato de {{propertyAddress}} ({{renterName}}) venció el {{dueDate}}.

El contrato quedó sin cobertura hasta que se cargue una póliza vigente.

Saludos,
{{agencyName}}`,
  ),
  SERVICE_OVERDUE: def(
    ['propertyAddress', 'dueDate', 'daysOverdue', 'renterName'],
    'Servicio vencido - {{propertyAddress}}',
    `Hola {{recipientName}},

La boleta de servicio de {{propertyAddress}} ({{renterName}}) venció el {{dueDate}} y lleva {{daysOverdue}} días de atraso.

Por favor regularizala y envianos el comprobante por WhatsApp al {{agencyWhatsapp}}.

Saludos,
{{agencyName}}`,
  ),
  STATEMENT_PENDING: def(
    ['period'],
    'Consolidados pendientes - {{period}}',
    `Hola {{recipientName}},

Todavía hay consolidados de propietarios sin cerrar correspondientes a {{period}}.

Ingresá al sistema para revisarlos y cerrarlos.

Saludos,
{{agencyName}}`,
  ),
  SETTLEMENT_CONFIRMED: def(
    ['propertyAddress', 'amount', 'period'],
    'Liquidación de {{period}} - {{propertyAddress}}',
    `Hola {{recipientName}},

Confirmamos la liquidación de {{period}} de {{propertyAddress}}. El monto neto a transferirte es de {{amount}}.

Adjuntamos el detalle en PDF. También lo encontrás en tu portal: {{portalUrl}}

Saludos,
{{agencyName}}`,
  ),
  OWNER_STATEMENT_CLOSED: def(
    ['period'],
    'Consolidado de {{period}}',
    `Hola {{recipientName}},

Cerramos tu consolidado de {{period}}. Adjuntamos el resumen en PDF con todas tus propiedades.

También lo encontrás en tu portal: {{portalUrl}}

Saludos,
{{agencyName}}`,
  ),
  PAYMENT_RECEIVED: def(
    ['propertyAddress', 'amount', 'period'],
    'Recibimos tu pago - {{period}}',
    `Hola {{recipientName}},

Registramos tu pago de {{amount}} correspondiente a {{period}} de {{propertyAddress}}. Gracias.

Adjuntamos el recibo en PDF. También lo encontrás en tu portal: {{portalUrl}}

Saludos,
{{agencyName}}`,
  ),
}

/** Clave de la plantilla de email de un tipo (`PAYMENT_REMINDER.EMAIL`). */
export function emailTemplateKey(type: string): string {
  return `${type}.EMAIL`
}

/** El tipo al que pertenece una clave de plantilla, o null si no es válida. */
export function typeOfTemplateKey(key: string): NotificationTypeName | null {
  const match = /^([A-Z_]+)\.EMAIL$/.exec(key)
  if (!match) return null
  const type = match[1] as NotificationTypeName
  return DEFAULT_EMAIL_TEMPLATES[type] ? type : null
}

// ------------------------------------------------------------------ Render

const PLACEHOLDER = /\{\{\s*(\w+)\s*\}\}/g

/** Nombres de variable usados en un texto, sin repetidos. */
export function variablesUsed(text: string): string[] {
  return [...new Set([...text.matchAll(PLACEHOLDER)].map((m) => m[1]))]
}

export function unknownVariables(text: string, allowed: string[]): string[] {
  return variablesUsed(text).filter((name) => !allowed.includes(name))
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Reemplaza `{{variable}}`. Una variable sin valor queda vacía: no se rompe un
 * recordatorio por un campo faltante. `escape` se aplica al texto fijo y a los
 * valores por igual (en el HTML, los dos van escapados).
 */
export function fillTemplate(
  template: string,
  values: Record<string, string | undefined>,
  escape: (value: string) => string = (value) => value,
): string {
  let out = ''
  let last = 0
  for (const match of template.matchAll(PLACEHOLDER)) {
    out += escape(template.slice(last, match.index))
    out += escape(values[match[1]] ?? '')
    last = match.index + match[0].length
  }
  return out + escape(template.slice(last))
}

export interface RenderedEmail {
  subject: string
  text: string
  /** El cuerpo ya escapado, en párrafos; el layout lo envuelve. */
  htmlBody: string
}

export function renderEmail(
  subject: string,
  bodyText: string,
  values: Record<string, string | undefined>,
): RenderedEmail {
  const text = fillTemplate(bodyText, values)
  return {
    // El asunto es una sola línea.
    subject: fillTemplate(subject, values).replace(/\s+/g, ' ').trim(),
    text,
    htmlBody: paragraphsToHtml(fillTemplate(bodyText, values, escapeHtml)),
  }
}

/** Párrafos separados por línea en blanco; el salto simple pasa a `<br>`. */
export function paragraphsToHtml(escapedText: string): string {
  return escapedText
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map(
      (paragraph) =>
        `<p style="margin:0 0 16px;line-height:1.5">${paragraph.replace(/\n/g, '<br>')}</p>`,
    )
    .join('\n')
}

export interface LayoutBranding {
  agencyName: string
  logoUrl?: string | null
  primaryColor?: string | null
  contactLine?: string | null
}

const DEFAULT_COLOR = '#c2410c'

/** Sólo hex válido: el color viene de la base y va a un atributo `style`. */
export function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_COLOR
}

/** HTML del mail: encabezado con logo y color, cuerpo y pie con contacto. */
export function renderLayout(
  htmlBody: string,
  branding: LayoutBranding,
): string {
  const color = safeColor(branding.primaryColor)
  const logo =
    branding.logoUrl && /^https?:\/\//.test(branding.logoUrl)
      ? `<img src="${escapeHtml(branding.logoUrl)}" alt="${escapeHtml(branding.agencyName)}" style="max-height:48px;display:block">`
      : `<span style="font-size:20px;font-weight:bold;color:#ffffff">${escapeHtml(branding.agencyName)}</span>`
  const footer = branding.contactLine
    ? `<p style="margin:0;font-size:12px;color:#6b7280">${escapeHtml(branding.contactLine)}</p>`
    : ''
  return `<!doctype html>
<html lang="es"><body style="margin:0;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;color:#111827">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${color};padding:16px 24px">${logo}</td></tr>
<tr><td style="padding:24px;font-size:15px">${htmlBody}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e5e7eb">${footer}</td></tr>
</table></td></tr></table></body></html>`
}
