import { AsyncJob, AsyncJobStatus } from './async-job.entity'

export interface CreateAsyncJobData {
  type: string
  startedById: string | null
  totalItems: number | null
}

/**
 * Puerto del repositorio de trabajos. Todo corre dentro del tenant del
 * contexto (filtro de tenant de Prisma): un id de otro tenant no existe.
 */
export abstract class AsyncJobRepository {
  abstract create(data: CreateAsyncJobData): Promise<AsyncJob>

  abstract findById(id: string): Promise<AsyncJob | null>

  abstract markProcessing(id: string): Promise<void>

  /**
   * Suma ítems terminados de forma atómica (un `increment` en la base): varios
   * workers pueden reportar a la vez sin pisarse el contador.
   */
  abstract recordItems(
    id: string,
    counts: { processed: number; failed: number },
  ): Promise<AsyncJob>

  abstract finish(
    id: string,
    status: AsyncJobStatus,
    result: unknown,
  ): Promise<void>
}
