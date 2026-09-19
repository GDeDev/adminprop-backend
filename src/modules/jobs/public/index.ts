/**
 * API pública del módulo de trabajos en background. Otros módulos importan
 * `JobsModule` en su módulo de Nest y le inyectan `AsyncJobsFacade`.
 */
export { JobsModule } from '../infrastructure/modules/jobs.module'
export { AsyncJobsFacade } from './async-jobs.facade'
export { AsyncJobStatus } from '../domain/async-job.entity'
