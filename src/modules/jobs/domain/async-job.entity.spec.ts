import {
  AsyncJobStatus,
  finalStatus,
  isFinished,
  progressPercentage,
} from './async-job.entity'

describe('finalStatus', () => {
  it('sin fallos, el trabajo termina COMPLETED', () => {
    expect(finalStatus({ processedItems: 10, failedItems: 0 })).toBe(
      AsyncJobStatus.Completed,
    )
  })

  it('con algunos fallos, COMPLETED_WITH_ERRORS', () => {
    expect(finalStatus({ processedItems: 10, failedItems: 3 })).toBe(
      AsyncJobStatus.CompletedWithErrors,
    )
  })

  it('si fallaron todos, FAILED', () => {
    expect(finalStatus({ processedItems: 4, failedItems: 4 })).toBe(
      AsyncJobStatus.Failed,
    )
  })

  it('un trabajo sin ítems (nada que hacer) termina COMPLETED', () => {
    expect(finalStatus({ processedItems: 0, failedItems: 0 })).toBe(
      AsyncJobStatus.Completed,
    )
  })
})

describe('progressPercentage', () => {
  it('calcula el avance sobre el total, redondeando hacia abajo', () => {
    // Hacia abajo: nunca mostrar 100% con un ítem todavía pendiente.
    expect(
      progressPercentage({
        status: AsyncJobStatus.Processing,
        processedItems: 199,
        totalItems: 200,
      }),
    ).toBe(99)
  })

  it('sin total conocido devuelve null', () => {
    expect(
      progressPercentage({
        status: AsyncJobStatus.Processing,
        processedItems: 5,
        totalItems: null,
      }),
    ).toBeNull()
  })

  it('un trabajo terminado está al 100 aunque no se conozca el total', () => {
    expect(
      progressPercentage({
        status: AsyncJobStatus.CompletedWithErrors,
        processedItems: 5,
        totalItems: null,
      }),
    ).toBe(100)
  })
})

describe('isFinished', () => {
  it.each([
    [AsyncJobStatus.Pending, false],
    [AsyncJobStatus.Processing, false],
    [AsyncJobStatus.Completed, true],
    [AsyncJobStatus.CompletedWithErrors, true],
    [AsyncJobStatus.Failed, true],
  ])('%s → %s', (status, expected) => {
    expect(isFinished({ status })).toBe(expected)
  })
})
