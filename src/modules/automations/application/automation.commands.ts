/** Corrida manual de un job (`POST /automations/jobs/:job/run`). */
export class RunJobCommand {
  constructor(
    public readonly job: string,
    public readonly period: string | undefined,
  ) {}
}

export class MarkAlertReadCommand {
  constructor(public readonly id: string) {}
}

export class MarkAllAlertsReadCommand {}

export class ListJobsQuery {}

export class ListExecutionsQuery {
  constructor(
    public readonly filter: {
      job?: string
      status?: string
      from?: string
      to?: string
    },
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class ListAlertsQuery {
  constructor(
    public readonly unreadOnly: boolean,
    public readonly page: { page?: number; limit?: number },
  ) {}
}

export class GetIndexStatusQuery {}
