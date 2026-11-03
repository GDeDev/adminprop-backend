/**
 * API pública de la migración (Fase 21): el módulo (para `app.module`) y la
 * facade con la limpieza de lotes vencidos.
 */
export { MigrationModule } from '../infrastructure/modules/migration.module'
export { MigrationFacade } from './migration.facade'
export { STALE_BATCH_DAYS } from '../application/batch-discarder'
