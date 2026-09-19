export interface ExampleActivity {
  id: string
  exampleItemId: string
  description: string
  createdAt: Date
}

/** Puerto del repositorio de actividad. Corre dentro del tenant del contexto. */
export abstract class ExampleActivityRepository {
  abstract record(
    exampleItemId: string,
    description: string,
  ): Promise<ExampleActivity>

  abstract listFor(exampleItemId: string): Promise<ExampleActivity[]>
}
