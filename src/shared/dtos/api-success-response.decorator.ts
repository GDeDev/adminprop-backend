import { applyDecorators, Type } from '@nestjs/common'
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger'

import { ApiSuccessDto } from './api-response.dto'

/**
 * Documenta una respuesta `{ success, message, data }` cuyo `data` es `model`.
 *
 * OpenAPI no tiene genéricos: con `@ApiResponse({ type: Modelo })` el contrato
 * muestra el modelo desnudo aunque el handler devuelva el sobre, y los tipos
 * generados para el frontend mienten. Acá se arma el schema referenciando
 * `ApiSuccessDto` y el modelo concreto (D-197).
 */
export function ApiSuccessResponse<TModel extends Type<unknown>>(
  model: TModel,
  description: string,
  status = 200,
) {
  return applyDecorators(
    ApiExtraModels(ApiSuccessDto, model),
    ApiResponse({
      status,
      description,
      schema: {
        allOf: [
          { $ref: getSchemaPath(ApiSuccessDto) },
          {
            type: 'object',
            properties: { data: { $ref: getSchemaPath(model) } },
            required: ['data'],
          },
        ],
      },
    }),
  )
}
