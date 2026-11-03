# Fase 25 — Inventario del contrato (backend)

Sin spec previa: sale de `adminprop-repo-files/docs/REDISENO_FASE_25.md` y de `shared-types/inventory.ts` (el contrato HTTP). Rama `feature/fase-25-inventario`, **encadenada sobre `feature/fase-19-estadisticas`**. Hecha **sin supervisión**. Decisiones D-126 a D-132 y supuestos A-97 a A-103 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño llamaba A-42 a A-45 a los cuatro primeros).

## Qué quedó construido

**Migración `add_inventories`**: enums `InventoryType`, `InventoryStatus`, `ItemCondition`; tablas `property_inventories`, `inventory_items` (cascade desde el inventario) e `inventory_photos` (cascade desde el ítem); y dos índices únicos parciales (D-127). Los tres modelos están declarados en `auditable-models.ts` (tenant-scoped; sólo el inventario con auditoría).

**Módulo `src/modules/inventory`**:

| Capa             | Piezas                                                                                                                                                                                                                                                         |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `inventory.ts` (tipos, límites), `inventory.policy.ts` (reglas puras: fechas, ítems, devolución, estados, avisos, validación de fotos), `inventory-comparison.ts` (comparación pura), `inventory-template.ts`, `inventory.exceptions.ts`, `inventory.ports.ts` |
| `application`    | `inventory.commands.ts` / `inventory.handlers.ts` (crear, editar, subir y borrar fotos, confirmar, corregir), `inventory.queries.ts` (listado, detalle, comparación), `inventory.views.ts`                                                                     |
| `infrastructure` | `InventoryRepositoryImpl` (Prisma, transacciones), `InventoryController`, `inventory.dtos.ts`, `InventoryModule`                                                                                                                                               |

Depende de `ContractsFacade`, `AuditFacade` y `UsersFacade`. Fotos en `inventories/<tenantId>/<inventoryId>/<uuid>.<ext>` por `StoragePort`.

## Endpoints (admin y empleado, `{ success, message, data }`)

| Ruta                                             | Notas                                                                                      |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `GET /contracts/:contractId/inventories`         | vigentes + `canCreateDelivery` + `canCreateReturn`                                         |
| `GET /contracts/:contractId/inventories/compare` | `InventoryComparison`                                                                      |
| `POST /contracts/:contractId/inventories`        | 201, borrador con la plantilla si no hay `items`                                           |
| `GET /inventories/:id`                           | `InventoryDetail`                                                                          |
| `PATCH /inventories/:id`                         | sólo borrador; `items` reemplaza la lista                                                  |
| `POST /inventories/:id/items/:itemId/photos`     | 201, multipart `files` (5 por pedido, 15 por ítem, 10 MB, JPG/PNG/WebP/HEIC por contenido) |
| `DELETE /inventories/:id/photos/:photoId`        | sólo borrador                                                                              |
| `POST /inventories/:id/confirm`                  | 200; exige un ítem evaluado                                                                |
| `POST /inventories/:id/correct`                  | 201, body `{ reason }`                                                                     |

Errores: 404 `INVENTORY_NOT_FOUND`, `INVENTORY_CONTRACT_NOT_FOUND`, `INVENTORY_ITEM_NOT_FOUND`, `INVENTORY_PHOTO_NOT_FOUND`; 409 `INVENTORY_CONFIRMED`, `INVENTORY_ALREADY_EXISTS`, `INVENTORY_NOT_CONFIRMED`, `INVENTORY_SUPERSEDED`, `INVENTORY_CORRECTION_PENDING`; 422 `INVENTORY_RETURN_NOT_ALLOWED`, `INVENTORY_EMPTY`; 400 `INVENTORY_INVALID_DATE`, `INVENTORY_INVALID_ITEM`, `INVENTORY_INVALID_PHOTO`, `INVENTORY_TOO_MANY_PHOTOS`.

## Desvíos respecto de shared-types

Ninguno en las respuestas. Superconjunto en la entrada: `CreateInventoryRequest` acepta además `items` (D-132). `confirmedAt` sale como fecha-hora ISO; `warnings` viene en todo `InventoryDetail`.

## Cambio fuera del módulo

`GlobalExceptionFilter` traduce `MulterError` a 400/413 (D-131).

## Tests

- Unitarios: política (devolución a 30 días, estados, avisos, fotos por firma), comparación, handlers (limpieza de subidas fallidas, archivos compartidos, copia de correcciones) y el filtro.
- E2E `test/inventory.e2e-spec.ts` (18 casos): alta con plantilla, edición, fotos, confirmación e inmutabilidad, devolución y comparación, corrección completa, permisos (401, portal 403, empleado) y aislamiento entre inmobiliarias (404 en todo).

## Mapa de supuestos

| Rediseño | Backend |
| -------- | ------- |
| A-42     | A-97    |
| A-43     | A-98    |
| A-44     | A-99    |
| A-45     | A-100   |
