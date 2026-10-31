/** Los jobs de negocio (Fase 13, 2). El nombre es estable: lo ve el frontend. */
export enum JobName {
  INSTALLMENTS_GENERATE = 'installments.generate',
  RENT_UPDATES_APPLY = 'contracts.apply-rent-updates',
  CONTRACTS_FINISH_EXPIRED = 'contracts.finish-expired',
  INDICES_FETCH = 'indices.fetch',
  PAYMENT_REMINDER = 'billing.payment-reminder',
  ARREARS_NOTICE = 'billing.arrears-notice',
  INSURER_ALERT = 'billing.insurer-alert',
  CONTRACT_EXPIRY_NOTICE = 'contracts.expiry-notice',
  POLICY_EXPIRY_NOTICE = 'contracts.policy-expiry-notice',
  SERVICE_OVERDUE_NOTICE = 'services.overdue-notice',
  STATEMENT_REMINDER = 'settlements.statement-reminder',
}

/** Coinciden con los enums de Prisma. */
export enum JobExecutionStatus {
  RUNNING = 'RUNNING',
  SUCCEEDED = 'SUCCEEDED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

export enum JobTrigger {
  SCHEDULE = 'SCHEDULE',
  MANUAL = 'MANUAL',
}

/** Resultado de traer un índice de la fuente (`GET /indices/status`). */
export enum IndexFetchStatus {
  SUCCEEDED = 'SUCCEEDED',
  PARTIAL = 'PARTIAL',
  FAILED = 'FAILED',
  SKIPPED = 'SKIPPED',
}

/** `TENANT` corre una vez por inmobiliaria; `GLOBAL`, una sola vez (índices). */
export enum JobScope {
  TENANT = 'TENANT',
  GLOBAL = 'GLOBAL',
}

export interface JobDefinition {
  name: JobName
  /** En español, para el backoffice. */
  title: string
  description: string
  scope: JobScope
  /** Horas locales (`HH:MM`) en que corre cada día, de menor a mayor. */
  times: string[]
}

export const JOB_CATALOG: JobDefinition[] = [
  {
    name: JobName.INSTALLMENTS_GENERATE,
    title: 'Generar cuotas del mes',
    description:
      'Crea las cuotas del mes en curso que falten y, desde el día de generación, las del mes siguiente. No duplica las que ya existen.',
    scope: JobScope.TENANT,
    times: ['00:10'],
  },
  {
    name: JobName.RENT_UPDATES_APPLY,
    title: 'Aplicar aumentos de alquiler',
    description:
      'Aplica los aumentos ICL/IPC con los índices cargados y los fijos con porcentaje. Si falta el índice o el aumento es manual, avisa.',
    scope: JobScope.TENANT,
    times: ['00:20'],
  },
  {
    name: JobName.CONTRACTS_FINISH_EXPIRED,
    title: 'Finalizar contratos vencidos',
    description:
      'Marca como finalizados los contratos cuyo fin ya pasó y libera la propiedad y al inquilino.',
    scope: JobScope.TENANT,
    times: ['00:30'],
  },
  {
    name: JobName.INDICES_FETCH,
    title: 'Traer índices ICL e IPC',
    description:
      'Busca en el BCRA y el INDEC los meses de ICL e IPC que faltan. Un mes cargado no se pisa. Si la fuente falla, avisa.',
    scope: JobScope.GLOBAL,
    times: ['06:00', '12:00'],
  },
  {
    name: JobName.PAYMENT_REMINDER,
    title: 'Recordatorio de pago',
    description:
      'Desde el día de recordatorio, avisa a los inquilinos con la cuota del mes sin ningún pago, mientras no venza la gracia.',
    scope: JobScope.TENANT,
    times: ['09:00'],
  },
  {
    name: JobName.ARREARS_NOTICE,
    title: 'Aviso de mora',
    description:
      'Avisa una sola vez por cuota, el primer día después de la gracia, al inquilino y a la inmobiliaria, con el punitorio a ese día.',
    scope: JobScope.TENANT,
    times: ['09:10'],
  },
  {
    name: JobName.INSURER_ALERT,
    title: 'Alerta a la aseguradora',
    description:
      'Avisa a la aseguradora de las cuotas con caución que siguen sin pagarse después del día de recordatorio.',
    scope: JobScope.TENANT,
    times: ['09:20'],
  },
  {
    name: JobName.CONTRACT_EXPIRY_NOTICE,
    title: 'Aviso de contratos por vencer',
    description:
      'Avisa al propietario y a la inmobiliaria cuando faltan los días de anticipación configurados para el fin de un contrato.',
    scope: JobScope.TENANT,
    times: ['09:30'],
  },
  {
    name: JobName.POLICY_EXPIRY_NOTICE,
    title: 'Aviso de pólizas de caución',
    description:
      'Avisa a la inmobiliaria las pólizas que vencen en los próximos 30 días y las que ya vencieron.',
    scope: JobScope.TENANT,
    times: ['09:40'],
  },
  {
    name: JobName.SERVICE_OVERDUE_NOTICE,
    title: 'Aviso de servicios vencidos',
    description:
      'Avisa al inquilino y a la inmobiliaria los servicios con 5 días o más de vencidos.',
    scope: JobScope.TENANT,
    times: ['09:50'],
  },
  {
    name: JobName.STATEMENT_REMINDER,
    title: 'Recordatorio de consolidados',
    description:
      'Desde el día de informe mensual, avisa los propietarios con liquidaciones del mes anterior que todavía no se consolidaron.',
    scope: JobScope.TENANT,
    times: ['10:00'],
  },
]

export function findJobDefinition(name: string): JobDefinition | undefined {
  return JOB_CATALOG.find((job) => job.name === name)
}

/** Cron de 5 campos del job: `10 0 * * *`, o `0 6,12 * * *` con varias horas. */
export function cronOf(times: string[]): string {
  const parsed = times.map((t) => t.split(':').map(Number))
  const minutes = [...new Set(parsed.map(([, minute]) => minute))]
  const hours = parsed.map(([hour]) => hour).join(',')
  // Con minutos distintos entre horas no hay una sola expresión; no pasa con
  // el catálogo actual, y se muestra la primera.
  return `${minutes[0]} ${minutes.length === 1 ? hours : parsed[0][0]} * * *`
}

/** "todos los días a las 09:10", "todos los días a las 06:00 y 12:00". */
export function cronLabelOf(times: string[]): string {
  const list =
    times.length <= 1
      ? times.join('')
      : `${times.slice(0, -1).join(', ')} y ${times[times.length - 1]}`
  return `todos los días a las ${list}`
}
