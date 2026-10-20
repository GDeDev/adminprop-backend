/**
 * API pública de propietarios: lo único que otro módulo puede importar de acá.
 */
export { OwnersModule } from '../infrastructure/modules/owners.module'
export { OwnersFacade } from './owners.facade'
export type { OwnerRef } from './owners.facade'
/** La regla del honorario reducido: la Fase 12 la reusa al liquidar. */
export { appliesReducedFee } from '../domain/reduced-fee'
