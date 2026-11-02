/**
 * API pública de inquilinos: lo único que otro módulo puede importar de acá.
 */
export { RentersModule } from '../infrastructure/modules/renters.module'
export { RentersFacade } from './renters.facade'
export type {
  GuarantorRef,
  RenterContact,
  RenterContractInfo,
  RenterPortalProfile,
  RenterRef,
} from './renters.facade'
export { GuaranteeType } from '../domain/guarantor'
export { PaymentStatus } from '../domain/renter'
