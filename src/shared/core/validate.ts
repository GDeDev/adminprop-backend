import { Result } from './result'

export type ValidateResult = {
  message?: string
  success: boolean
}

export type ValidateArgument = {
  argument: any
  argumentName: string
}

export type ValidateResponse = string
export type ValidateArgumentCollection = ValidateArgument[]

export const isEmpty = (argument: any): boolean => {
  return argument === null || argument === undefined || argument === ''
}

export const isNullOrUndefined = (argument: any): boolean => {
  return argument === null || argument === undefined
}

export class Validate {
  static combine(guardResults: Result<any, any>[]): Result<ValidateResult> {
    for (const result of guardResults) {
      if (result.isFailure) return result
    }

    return Result.ok<ValidateResult>()
  }

  static isRequired(argument: any, argumentName: string): ValidateResult {
    if (!isEmpty(argument)) return { success: true }

    return {
      success: false,
      message: `${argumentName} can't be empty it's required`,
    }
  }

  static isRequiredBulk(args: ValidateArgumentCollection): ValidateResult {
    for (const arg of args) {
      const result = this.isRequired(arg.argument, arg.argumentName)
      if (!result.success) return result
    }

    return { success: true }
  }

  static isDate(
    argument: Date,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    if (
      argument.getMonth &&
      !isNullOrUndefined(argument.getMonth()) &&
      !Number.isNaN(argument.getMonth())
    )
      return Result.ok()

    return Result.fail({
      success: false,
      message: `${argumentName} is not a valid Date`,
    })
  }

  static isStringDate(
    argument: string,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    if (Date.parse(argument)) return Result.ok()

    return Result.fail({
      success: false,
      message: `${argumentName} is not a valid Date`,
    })
  }

  static isGreaterThan(
    num: number,
    min: number,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    const isGreaterThan = num > min
    if (!isGreaterThan || Number.isNaN(num)) {
      return Result.fail({
        success: false,
        message: `${argumentName} is not greater than ${min}.`,
      })
    }
    return Result.ok()
  }

  static isGreaterOrEqualThan(
    num: number,
    min: number,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    const isGreaterOrEqualThan = num >= min
    if (!isGreaterOrEqualThan || Number.isNaN(num)) {
      return Result.fail({
        success: false,
        message: `${argumentName} is not greater or equal than ${min}.`,
      })
    }

    return Result.ok()
  }

  static isLessThan(
    num: number,
    max: number,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    const isLessThan = num < max
    if (!isLessThan || Number.isNaN(num)) {
      return Result.fail({
        success: false,
        message: `${argumentName} is not less than ${max}.`,
      })
    }

    return Result.ok()
  }

  static isLessOrEqualThan(
    num: number,
    max: number,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    const isLessOrEqualThan = num <= max
    if (!isLessOrEqualThan || Number.isNaN(num)) {
      return Result.fail({
        success: false,
        message: `${argumentName} is not less or equal than ${max}.`,
      })
    }

    return Result.ok()
  }

  static againstNullOrUndefined(
    argument: any,
    argumentName: string,
  ): Result<undefined, ValidateResponse> {
    if (isNullOrUndefined(argument)) {
      return Result.fail(`${argumentName} is null or undefined`)
    } else {
      return Result.ok()
    }
  }

  static againstNullOrUndefinedBulk(
    args: ValidateArgumentCollection,
  ): Result<undefined, string> {
    for (const arg of args) {
      const result = this.againstNullOrUndefined(arg.argument, arg.argumentName)
      if (result.isFailure) return result
    }

    return Result.ok()
  }

  static inRange(
    num: number,
    min: number,
    max: number,
    argumentName: string,
  ): Result<undefined, ValidateResult> {
    const isInRange = num >= min && num <= max

    if (!isInRange || Number.isNaN(num)) {
      return Result.fail({
        success: false,
        message: `${argumentName} is not within range ${min} to ${max}.`,
      })
    }

    return Result.ok()
  }

  static againstAtLeast(
    numChars: number,
    text: string,
  ): Result<undefined, ValidateResult> {
    return text.length >= numChars
      ? Result.ok()
      : Result.fail({
          success: false,
          message: `Text is not at least ${numChars} chars.`,
        })
  }

  static againstAtMost(
    numChars: number,
    text: string,
  ): Result<undefined, ValidateResult> {
    return text.length <= numChars
      ? Result.ok()
      : Result.fail({
          success: false,
          message: `Text is greater than ${numChars} chars.`,
        })
  }
}
