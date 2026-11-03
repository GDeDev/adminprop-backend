/**
 * Catálogo de avisos del sistema (REDISENO_FASE_14, 3.1). Es la fuente de
 * verdad de qué tipos existen, para quién son, por qué canales pueden salir y
 * cuáles no se pueden apagar. Código puro: sin Nest ni Prisma.
 *
 * Los tipos y canales son uniones de strings (y no los enums de
 * `platform/notifications`) porque el dominio no importa de `platform`; los
 * valores coinciden con los de Prisma.
 */
export const NOTIFICATION_TYPES = [
  'PAYMENT_REMINDER',
  'ARREARS_NOTICE',
  'INSURER_ALERT',
  'CONTRACT_EXPIRING',
  'POLICY_EXPIRING',
  'POLICY_EXPIRED',
  'SERVICE_OVERDUE',
  'STATEMENT_PENDING',
  'SETTLEMENT_CONFIRMED',
  'OWNER_STATEMENT_CLOSED',
  'PAYMENT_RECEIVED',
  'PUBLIC_INQUIRY',
  'EMAIL_BOUNCED',
  'COMPARABLES_SOURCE_STALE',
  'NOTIFICATION_FAILED',
  'RENT_UPDATE_PENDING',
  'INDEX_FETCH_FAILED',
  'INSTALLMENT_BASE_OUTDATED',
  'JOB_FAILED',
  'DOCUMENT_FAILED',
] as const

export type NotificationTypeName = (typeof NOTIFICATION_TYPES)[number]

export type ChannelName = 'EMAIL' | 'WHATSAPP_LINK' | 'IN_APP'

export type SkipReasonName =
  | 'TYPE_DISABLED'
  | 'CHANNEL_DISABLED'
  | 'USER_OPTED_OUT'
  | 'NO_RECIPIENT_EMAIL'
  | 'NO_PHONE'

export interface CatalogEntry {
  type: NotificationTypeName
  title: string
  description: string
  /** Para quién es, en texto. */
  audience: string
  /** No se puede apagar ni por la inmobiliaria ni por un usuario. */
  mandatory: boolean
  /** Si falla del todo, el personal se entera por la campana (A-52). */
  critical: boolean
  enabledByDefault: boolean
  defaultChannels: ChannelName[]
  availableChannels: ChannelName[]
}

const EMAIL: ChannelName = 'EMAIL'
const WHATSAPP: ChannelName = 'WHATSAPP_LINK'
const IN_APP: ChannelName = 'IN_APP'

function entry(
  type: NotificationTypeName,
  title: string,
  description: string,
  audience: string,
  options: Partial<
    Pick<
      CatalogEntry,
      | 'mandatory'
      | 'critical'
      | 'enabledByDefault'
      | 'defaultChannels'
      | 'availableChannels'
    >
  > = {},
): CatalogEntry {
  const defaultChannels = options.defaultChannels ?? [EMAIL]
  return {
    type,
    title,
    description,
    audience,
    mandatory: options.mandatory ?? false,
    critical: options.critical ?? false,
    enabledByDefault: options.enabledByDefault ?? true,
    defaultChannels,
    availableChannels: options.availableChannels ?? defaultChannels,
  }
}

export const NOTIFICATION_CATALOG: readonly CatalogEntry[] = [
  entry(
    'PAYMENT_REMINDER',
    'Recordatorio de pago',
    'Avisa al inquilino que se acerca el vencimiento de la cuota del mes.',
    'Inquilino',
    {
      defaultChannels: [EMAIL, WHATSAPP],
      availableChannels: [EMAIL, WHATSAPP],
    },
  ),
  entry(
    'ARREARS_NOTICE',
    'Aviso de mora',
    'Avisa al inquilino y al personal que una cuota quedó impaga pasada la gracia.',
    'Inquilino y personal',
    {
      mandatory: true,
      critical: true,
      defaultChannels: [EMAIL, WHATSAPP],
      availableChannels: [EMAIL, WHATSAPP, IN_APP],
    },
  ),
  entry(
    'INSURER_ALERT',
    'Alerta a la aseguradora',
    'Avisa a la aseguradora del seguro de caución que el inquilino está en mora.',
    'Aseguradora',
    { mandatory: true, critical: true },
  ),
  entry(
    'CONTRACT_EXPIRING',
    'Contrato por vencer',
    'Avisa al propietario y al personal que un contrato está por terminar.',
    'Propietario y personal',
  ),
  entry(
    'POLICY_EXPIRING',
    'Póliza por vencer',
    'Avisa al personal que la póliza del seguro de un contrato está por vencer.',
    'Personal',
  ),
  entry(
    'POLICY_EXPIRED',
    'Póliza vencida',
    'Avisa al personal que la póliza del seguro de un contrato ya venció.',
    'Personal',
  ),
  entry(
    'SERVICE_OVERDUE',
    'Servicio vencido',
    'Avisa al inquilino y al personal que una boleta de servicio está vencida.',
    'Inquilino y personal',
    { availableChannels: [EMAIL, WHATSAPP] },
  ),
  entry(
    'STATEMENT_PENDING',
    'Consolidado pendiente',
    'Recuerda al personal que hay consolidados de propietarios sin cerrar.',
    'Personal',
    { defaultChannels: [IN_APP], availableChannels: [IN_APP, EMAIL] },
  ),
  entry(
    'SETTLEMENT_CONFIRMED',
    'Liquidación confirmada',
    'Manda al propietario la liquidación del mes con el PDF adjunto.',
    'Propietario',
    { critical: true },
  ),
  entry(
    'OWNER_STATEMENT_CLOSED',
    'Consolidado cerrado',
    'Manda al propietario el consolidado del mes con el PDF adjunto.',
    'Propietario',
    { critical: true },
  ),
  entry(
    'PAYMENT_RECEIVED',
    'Recibo de pago',
    'Manda al inquilino el recibo cuando se registra su pago. Viene apagado: lo decide la inmobiliaria.',
    'Inquilino',
    { enabledByDefault: false },
  ),
  entry(
    'PUBLIC_INQUIRY',
    'Consulta del portal público',
    'Avisa al personal que llegó una consulta desde el portal público.',
    'Personal',
    { defaultChannels: [IN_APP], availableChannels: [IN_APP] },
  ),
  entry(
    'EMAIL_BOUNCED',
    'Email rebotado',
    'Avisa al personal que un mail no llegó (rebotó o fue marcado como spam) para corregir el email cargado.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'COMPARABLES_SOURCE_STALE',
    'Datos de mercado desactualizados',
    'Avisa al personal que una fuente de la tasación automática dejó de traer avisos, así que las sugerencias de precio pueden estar viejas.',
    'Personal',
    { defaultChannels: [IN_APP], availableChannels: [IN_APP] },
  ),
  entry(
    'NOTIFICATION_FAILED',
    'Aviso no enviado',
    'Avisa al personal que un aviso importante no pudo enviarse después de los reintentos.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'RENT_UPDATE_PENDING',
    'Aumento de alquiler pendiente',
    'Avisa al personal que hay un aumento por confirmar.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'INDEX_FETCH_FAILED',
    'Índice no disponible',
    'Avisa al personal que no se pudo traer el índice ICL o IPC.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'INSTALLMENT_BASE_OUTDATED',
    'Cuota con base desactualizada',
    'Avisa al personal que una cuota se generó con un alquiler que luego cambió.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'JOB_FAILED',
    'Tarea automática fallida',
    'Avisa al personal que una tarea automática terminó con error.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
  entry(
    'DOCUMENT_FAILED',
    'PDF no generado',
    'Avisa al personal que un PDF no pudo generarse.',
    'Personal',
    {
      mandatory: true,
      defaultChannels: [IN_APP],
      availableChannels: [IN_APP],
    },
  ),
]

const BY_TYPE = new Map(NOTIFICATION_CATALOG.map((item) => [item.type, item]))

export function findCatalogEntry(type: string): CatalogEntry | undefined {
  return BY_TYPE.get(type as NotificationTypeName)
}

export function isNotificationType(type: string): type is NotificationTypeName {
  return BY_TYPE.has(type as NotificationTypeName)
}

/** Los tipos de aviso interno que lee la campana (IN_APP al personal). */
export const ALERT_NOTIFICATION_TYPES: NotificationTypeName[] =
  NOTIFICATION_CATALOG.filter((item) =>
    item.defaultChannels.includes('IN_APP'),
  ).map((item) => item.type)
