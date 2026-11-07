/**
 * API pública de propiedades: lo único que otro módulo puede importar de acá.
 * El módulo de contratos la usa para validar la propiedad y marcarla como
 * alquilada o disponible.
 */
export { PropertiesModule } from '../infrastructure/modules/properties.module'
export {
  ListingCurrency,
  ListingOperation,
  PropertiesFacade,
  PropertyRentedEvent,
  PropertyStatus,
  PUBLIC_PROPERTY_SORTS,
} from './properties.facade'
export type {
  PropertyListingInfo,
  OwnerPortfolio,
  OwnerPropertySummary,
  PropertyContractInfo,
  PropertyReportRef,
  PropertyRef,
  PropertyValuationInfo,
  PublicFiltersView,
  PublicPropertyDetailView,
  PublicPropertyFilter,
  PublicPropertySort,
  PublicPropertySummaryView,
} from './properties.facade'
export type {
  PropertyImportData,
  PropertyImportSnapshot,
} from './properties.facade'
