export class Result<T, E = undefined> {
  public isSuccess: boolean
  public isFailure: boolean
  public error: E | string | undefined
  private _value: T | undefined

  public constructor(isSuccess: boolean, error?: E | string, value?: T) {
    if (isSuccess && error) {
      throw new Error(
        'InvalidOperation: A result cannot be successful and contain an error',
      )
    }
    if (!isSuccess && !error) {
      throw new Error(
        'InvalidOperation: A failing result needs to contain an error message',
      )
    }

    this.isSuccess = isSuccess
    this.isFailure = !isSuccess
    this.error = error
    this._value = value

    Object.freeze(this)
  }

  public getValue(): T {
    if (!this.isSuccess) {
      throw new Error(
        "Can't get the value of an error result. Use 'errorValue' instead.",
      )
    }

    return this._value!
  }

  public getErrorValue(): E {
    return this.error as E
  }

  /**
   * El tipo de error queda abierto (`E`) aunque un `ok` no lleve error: si
   * estuviera fijo en `undefined`, un `Result.ok()` no sería asignable a una
   * función que declara devolver `Result<T, MiError>`, que es el caso normal.
   */
  public static ok<U, E = undefined>(value?: U): Result<U, E> {
    return new Result<U, E>(true, undefined, value)
  }

  public static fail<U>(error: U): Result<undefined, U> {
    return new Result<undefined, U>(false, error)
  }

  public static combine(results: Result<any, any>[]): Result<any, any> {
    const errors: any[] = []

    for (const result of results) {
      if (result.isFailure) {
        errors.push(result.getErrorValue())
      }
    }

    if (errors.length) {
      return Result.fail(errors.join(' - '))
    }

    return Result.ok()
  }
}
