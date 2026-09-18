import { ValidationPipe } from '@nestjs/common'
import { ValidationError } from '@nestjs/common/interfaces/external/validation-error.interface'

import { AppException } from '../../errors/app.exception'
import { ErrorDetail } from '../../errors/error-codes'

/**
 * Pipe de validación global.
 *
 * Además de lo de siempre (transformar, whitelist, rechazar propiedades de
 * más), arma un error **por campo** en vez de concatenar todo en un string.
 * El cliente recibe:
 *
 * ```json
 * {
 *   "code": "VALIDATION_FAILED",
 *   "errors": [
 *     { "field": "email", "code": "isEmail", "message": "..." },
 *     { "field": "address.zipCode", "code": "isString", "message": "..." }
 *   ]
 * }
 * ```
 *
 * Los campos anidados se reportan con notación de punto y los de array con
 * índice (`items[0].qty`), así el frontend puede pintar el error justo donde va.
 */
export class CustomValidationPipe extends ValidationPipe {
  constructor() {
    super({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
      forbidUnknownValues: true,
      stopAtFirstError: false,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
      exceptionFactory: (errors: ValidationError[]) => {
        const details = CustomValidationPipe.flatten(errors)

        return AppException.validation(
          'La validación de los datos enviados falló',
          details,
        )
      },
    })
  }

  private static flatten(
    errors: ValidationError[],
    parentPath = '',
  ): ErrorDetail[] {
    const details: ErrorDetail[] = []

    for (const error of errors) {
      const path = CustomValidationPipe.buildPath(parentPath, error.property)

      for (const [rule, message] of Object.entries(error.constraints ?? {})) {
        details.push({ field: path, code: rule, message })
      }

      if (error.children?.length) {
        details.push(...CustomValidationPipe.flatten(error.children, path))
      }
    }

    return details
  }

  private static buildPath(parentPath: string, property: string): string {
    if (!parentPath) return property
    // class-validator usa el índice como `property` en los errores de array.
    return /^\d+$/.test(property)
      ? `${parentPath}[${property}]`
      : `${parentPath}.${property}`
  }
}
