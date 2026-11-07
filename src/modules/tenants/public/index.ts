/**
 * API pública de `tenants`: lo único que otro módulo puede importar de acá.
 */
export { TenantsModule } from '../infrastructure/modules/tenants.module'
export { TenantsFacade } from './tenants.facade'
export type {
  ActiveTenantRef,
  PublicTenantRef,
  TenantAutomationSettings,
  TenantBrandingData,
  TenantBillingSettings,
  TenantContractSettings,
} from './tenants.facade'
export type { TenantSettingsPatch } from '../domain/tenant.entity'
