/**
 * API pública del CRM (Fase 23). El portal público registra consultas y
 * vistas por `CrmFacade`; `app.module` importa `CrmModule`.
 */
export { CrmModule } from '../infrastructure/modules/crm.module'
export { CrmFacade } from './crm.facade'
export type {
  FollowUpSummary,
  NewPortalInquiry,
  RegisteredInquiry,
} from './crm.facade'
