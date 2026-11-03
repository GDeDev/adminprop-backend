/**
 * API pública de propiedades: lo único que otro módulo puede importar de acá.
 * El módulo de contratos la usa para validar la propiedad y marcarla como
 * alquilada o disponible.
 */
export { PropertiesModule } from '../infrastructure/modules/properties.module'
export {
  ListingCurrency,
  PropertiesFacade,
  PropertyStatus,
} from './properties.facade'
export type {
  OwnerPortfolio,
  OwnerPropertySummary,
  PropertyContractInfo,
  PropertyReportRef,
  PropertyRef,
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertyFilter,
  PublicPropertySummaryView,
} from './properties.facade'
