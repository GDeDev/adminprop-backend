/**
 * API pública de índices: lo único que otro módulo puede importar de acá.
 */
export { IndicesModule } from '../infrastructure/modules/indices.module'
export { IndicesFacade } from './indices.facade'
export { IndexType } from '../domain/index-value'
