/**
 * Links de WhatsApp (rediseño Fase 14, sección 5 y A-57). Copia de
 * `apps/backoffice/src/lib/whatsapp.ts` del frontend, con los mismos casos de
 * prueba, hasta que se extraiga un paquete común (A-57).
 */

const NATIONAL_LENGTH = 10

/** Saca el "15" de celular que va después de la característica (11 15 1234 5678). */
function stripMobile15(national: string): string {
  if (national.length !== NATIONAL_LENGTH + 2) return national
  for (const areaLength of [2, 3, 4]) {
    if (national.slice(areaLength, areaLength + 2) === '15') {
      return national.slice(0, areaLength) + national.slice(areaLength + 2)
    }
  }
  return national
}

/**
 * Deja un teléfono como número internacional de WhatsApp (sólo dígitos).
 * Sin código de país se asume argentino móvil: prefijo 549 (A-57). Devuelve
 * null si no queda un número de 10 dígitos nacionales.
 */
export function normalizeWhatsAppPhone(
  phone: string | null | undefined,
): string | null {
  if (!phone) return null
  const trimmed = phone.trim()
  let digits = trimmed.replace(/\D/g, '')
  if (!digits) return null
  if (digits.startsWith('00')) digits = digits.slice(2)
  else if (trimmed.startsWith('+') && !digits.startsWith('54')) {
    // Otro país con "+": se respeta tal cual.
    return digits.length >= 8 && digits.length <= 15 ? digits : null
  }

  let national = digits
  if (digits.startsWith('54')) {
    national = digits.slice(2)
    if (national.startsWith('9')) national = national.slice(1)
  }
  if (national.startsWith('0')) national = national.slice(1)
  national = stripMobile15(national)
  return national.length === NATIONAL_LENGTH ? `549${national}` : null
}

/**
 * `https://wa.me/<dígitos>?text=<mensaje codificado>`; sin mensaje, sin `text`.
 * Sin teléfono utilizable devuelve null (el botón se oculta).
 */
export function buildWhatsAppLink(
  phone: string | null | undefined,
  message?: string | null,
): string | null {
  const digits = normalizeWhatsAppPhone(phone)
  if (!digits) return null
  const base = `https://wa.me/${digits}`
  return message ? `${base}?text=${encodeURIComponent(message)}` : base
}

/** Reemplaza `{{variable}}`; una variable sin valor queda vacía (igual que la API). */
export function fillTemplate(
  body: string,
  values: Record<string, string | null | undefined>,
): string {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => {
    return values[name] ?? ''
  })
}
