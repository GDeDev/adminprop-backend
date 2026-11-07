/**
 * API pública de propietarios: lo único que otro módulo puede importar de acá.
 */
export { OwnersModule } from '../infrastructure/modules/owners.module'
export { OwnersFacade } from './owners.facade'
export type {
  OwnerContact,
  OwnerPortalProfile,
  OwnerRef,
} from './owners.facade'
export { StatementSendMode } from '../domain/owner'
export type { OwnerFeeSettings } from '../domain/owner'
/** La regla del honorario reducido: la Fase 12 la reusa al liquidar. */
export { appliesReducedFee } from '../domain/reduced-fee'
export type { OwnerImportData, OwnerImportSnapshot } from './owners.facade'
