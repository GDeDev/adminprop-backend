import { Injectable } from '@nestjs/common'

import { ContractsFacade } from '@/modules/contracts/public'
import { JobName } from '../../domain/job-catalog'
import { AutomationJob, JobContext, JobOutcome } from '../job.types'

/** Finaliza los contratos cuyo fin ya pasó (D-61). Ya es idempotente. */
@Injectable()
export class FinishExpiredContractsJob implements AutomationJob {
  readonly name = JobName.CONTRACTS_FINISH_EXPIRED

  constructor(private readonly contracts: ContractsFacade) {}

  async run(context: JobContext): Promise<JobOutcome> {
    const finished = await this.contracts.finishExpired(context.today)
    return {
      affected: finished,
      summary:
        finished === 0
          ? 'Ningún contrato para finalizar'
          : `${finished} contratos finalizados`,
    }
  }
}
