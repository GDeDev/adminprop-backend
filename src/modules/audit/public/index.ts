/**
 * API pública de auditoría (Fase 20). `AuditRecorderModule` + `AuditFacade`
 * son lo que cualquier módulo importa para dejar constancia de un evento;
 * `AuditModule` (la pantalla) sólo lo importa `app.module`.
 */
export { AuditModule } from '../infrastructure/modules/audit.module'
export { AuditRecorderModule } from '../infrastructure/modules/audit-recorder.module'
export { AuditFacade } from './audit.facade'
export { actorKindOf, eventChanges } from '@/shared/audit/audit-event'
export type {
  AuditAction,
  AuditActorKind,
  AuditEventInput,
} from '@/shared/audit/audit-event'
