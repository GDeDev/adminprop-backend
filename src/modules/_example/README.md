# `_example` — módulo de referencia

**No se borra.** Es el patrón que copian las fases siguientes (CLAUDE.md del
proyecto, "Módulo de Referencia"). Ante la duda de "¿así se ve un Handler
acá?", la respuesta está en estos archivos, no en la prosa de la spec.

No pertenece a ningún dominio real: un `ExampleItem` con nombre, precio y un
adjunto.

## Qué demuestra y dónde

| Patrón                                                     | Archivo                                                                                 |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Entidad Prisma con `tenantId`, dinero, audit y soft delete | `prisma/schema.prisma` (`ExampleItem`) + `shared/prisma/extensions/auditable-models.ts` |
| Entidad de dominio (dinero como `string`)                  | `domain/example-item.entity.ts`                                                         |
| Domain Service con reglas puras                            | `domain/example-item.policy.ts` (+ `.spec.ts`, sin mocks)                               |
| Excepciones de dominio (`DomainException`)                 | `domain/example-item.exceptions.ts`                                                     |
| Puerto del repositorio (clase abstracta)                   | `domain/example-item.repository.ts`                                                     |
| Command + Handler                                          | `application/commands/create-example-item/`                                             |
| Query + Handler                                            | `application/queries/get-example-item/`                                                 |
| Vista de salida (nunca la fila de Prisma)                  | `application/example-item.view.ts`                                                      |
| Evento por `EventBus` → transporte pg-boss                 | `application/events/` + `public/example-events.ts`                                      |
| `StoragePort` (adjunto)                                    | `application/commands/attach-example-file/`                                             |
| Feature flag por tenant + acción pesada (202)              | `application/commands/recalculate-example-prices/`                                      |
| Worker de la cola con `AsyncJob` y reintento               | `infrastructure/workers/recalculate-prices.worker.ts`                                   |
| Repositorio con `prisma.db` (sin tenant a mano)            | `infrastructure/repositories/example-item.repository.impl.ts`                           |
| Controller sin lógica, DTOs con `@IsMoneyAmount`           | `infrastructure/http/`                                                                  |
| Facade pública para otros módulos                          | `public/example-items.facade.ts` + `public/index.ts`                                    |
| Segundo módulo que escucha por eventos                     | `../_example-listener/`                                                                 |
| Tests e2e contra Postgres y pg-boss reales                 | `test/example.e2e-spec.ts`                                                              |

## Flujo de una request

```
POST /api/v1/examples
  → ExampleItemsController         valida el DTO, arma el command
  → CommandBus → CreateExampleItemHandler
      → ExampleItemPolicy          reglas: nombre normalizado, precio > 0
      → ExampleItemRepository      prisma.db: tenant, auditoría y soft delete solos
      → EventBus: ExampleItemCreatedEvent
          → RelayExampleItemCreatedHandler → QueuePort (pg-boss)
              → _example-listener: ExampleItemCreatedConsumer
                  (corre dentro del tenant del alta)
```

## Endpoints (ADMIN y EMPLOYEE)

| Método | Ruta                              | Qué muestra                                      |
| ------ | --------------------------------- | ------------------------------------------------ |
| POST   | `/api/v1/examples`                | Command, reglas, 409 / 422, evento               |
| GET    | `/api/v1/examples/:id`            | Query, 404 cross-tenant                          |
| POST   | `/api/v1/examples/:id/attachment` | StoragePort, validación de archivo por contenido |
| POST   | `/api/v1/examples/recalculate`    | Flag, 202 + AsyncJob + pg-boss con reintento     |

Para probar el aumento masivo en local, prendé el flag
`example-bulk-recalculate` en Flagsmith para tu tenant (o usá
`FEATURE_FLAGS_PROVIDER=memory` con `FEATURE_FLAGS_ENABLED=example-bulk-recalculate`).
