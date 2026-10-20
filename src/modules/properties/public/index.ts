/**
 * API pública de propiedades. La Fase 9 (contratos) va a sumar lo necesario
 * para marcar una propiedad como alquilada o disponible.
 */
export { PropertiesModule } from '../infrastructure/modules/properties.module'
export { PropertiesFacade, PropertyStatus } from './properties.facade'
export type { OwnerPortfolio, OwnerPropertySummary } from './properties.facade'
