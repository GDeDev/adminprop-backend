import {
  CatalogEntry,
  ChannelName,
  SkipReasonName,
} from './notification-catalog'

/**
 * Reglas de entrega (REDISENO_FASE_14, 3.3 y 2.1): qué canales quedan para un
 * aviso después de mirar la configuración de la inmobiliaria, la preferencia
 * personal y los datos de contacto; y cuándo se reintenta. Código puro.
 */
export interface TenantSettingState {
  enabled: boolean
  channels: ChannelName[]
}

export interface UserPreferenceState {
  emailEnabled: boolean
  inAppEnabled: boolean
}

export interface DeliveryInput {
  entry: CatalogEntry
  /** Lo que pidió quien llama (los jobs). */
  requestedChannels: ChannelName[]
  /** Fila de `notification_settings`; sin ella rige el default del catálogo. */
  setting?: TenantSettingState | null
  /** Preferencia del usuario destinatario (sólo personal con usuario). */
  userPreference?: UserPreferenceState | null
  email?: string | null
  phone?: string | null
}

export type DeliveryDecision =
  | { send: true; channels: ChannelName[] }
  | { send: false; reason: SkipReasonName }

export function decideDelivery(input: DeliveryInput): DeliveryDecision {
  const { entry } = input

  // 1. El tipo está habilitado (un obligatorio nunca se apaga).
  const enabled = entry.mandatory
    ? true
    : (input.setting?.enabled ?? entry.enabledByDefault)
  if (!enabled) return { send: false, reason: 'TYPE_DISABLED' }

  // 2. Canales: lo pedido, dentro de lo permitido por la inmobiliaria.
  const allowed = input.setting?.channels ?? entry.defaultChannels
  let channels = input.requestedChannels.filter(
    (channel) =>
      allowed.includes(channel) && entry.availableChannels.includes(channel),
  )
  if (channels.length === 0) return { send: false, reason: 'CHANNEL_DISABLED' }

  // 3. Preferencia personal, sólo en tipos no obligatorios.
  if (input.userPreference && !entry.mandatory) {
    channels = channels.filter(
      (channel) =>
        !(channel === 'EMAIL' && !input.userPreference?.emailEnabled) &&
        !(channel === 'IN_APP' && !input.userPreference?.inAppEnabled),
    )
    if (channels.length === 0) return { send: false, reason: 'USER_OPTED_OUT' }
  }

  // 4. Datos de contacto del canal principal (el que define la fila).
  const [primary] = channels
  if (primary === 'EMAIL' && !input.email?.trim()) {
    return { send: false, reason: 'NO_RECIPIENT_EMAIL' }
  }
  if (primary === 'WHATSAPP_LINK' && !input.phone?.trim()) {
    return { send: false, reason: 'NO_PHONE' }
  }
  return { send: true, channels }
}

/** Espera antes de cada reintento (A-51): 1, 5 y 30 minutos. */
export const RETRY_DELAYS_SECONDS = [60, 5 * 60, 30 * 60]

/** Primer intento más los tres reintentos. */
export const MAX_DELIVERY_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1

/**
 * Segundos hasta el próximo intento, dado cuántos se hicieron ya; `null` si se
 * agotaron.
 */
export function retryDelaySeconds(attemptsMade: number): number | null {
  if (attemptsMade < 1 || attemptsMade >= MAX_DELIVERY_ATTEMPTS) return null
  return RETRY_DELAYS_SECONDS[attemptsMade - 1]
}

/** Tope de adjuntos por mail (A-59). */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** Cuántas veces espera a que el PDF esté listo antes de salir sin adjunto (A-59). */
export const MAX_ATTACHMENT_WAITS = 3
