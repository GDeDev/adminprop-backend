/**
 * API pública de los maestros: lo único que otro módulo puede importar de acá.
 */
export { MasterDataModule } from '../infrastructure/modules/master-data.module'
export { MasterDataFacade } from './master-data.facade'
export { Catalog } from '../domain/catalog'
export { LocationLevel } from '../domain/location'
