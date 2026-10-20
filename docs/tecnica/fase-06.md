# Fase 6 — Propiedades (backend)

Spec: `adminprop-repo-files/specs/fase-06-propiedades.md`. Rama `feature/fase-06-propiedades`, **encadenada sobre `feature/fase-05-maestros`**.

Hecha **sin supervisión**. Decisiones: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-31 a D-37.

## Qué quedó construido

- **Tablas** (migración `add_properties`): `properties` (dirección, ubicación, tipo, estado `AVAILABLE`/`RENTED`/`MAINTENANCE`, propietario opcional, amenities `uuid[]`, notas, borrado lógico, auditoría) y `property_photos` (key, URL, posición). Índice trigram para buscar por dirección.
- **Módulo `src/modules/properties`**: reglas puras en `domain/property.policy.ts` (estados, límite de fotos, borrado), validación contra maestros (`MasterDataReferences`), vistas armadas en lote (`PropertyViews`), puerto `PropertyContracts` para la Fase 9.
- **`MasterDataFacade`** ahora describe ids en lote (tipos, amenities, ubicaciones con su ruta legible).
- **`DomainErrorKind.InvalidInput`** → 400, para límites de entrada del dominio.

## Endpoints (`/api/v1/properties`, admin y empleado)

| Método | Ruta                          | Qué hace                                                          |
| ------ | ----------------------------- | ----------------------------------------------------------------- |
| GET    | `/properties`                 | Paginado; filtros `status`, `ownerId`, `propertyTypeId`, `search` |
| GET    | `/properties/:id`             | Ficha con maestros expandidos y fotos                             |
| POST   | `/properties`                 | Alta; queda `AVAILABLE`                                           |
| PATCH  | `/properties/:id`             | Editar (todo menos estado y fotos)                                |
| PATCH  | `/properties/:id/status`      | Cambio manual de estado                                           |
| POST   | `/properties/:id/photos`      | Subir fotos (multipart `files`)                                   |
| DELETE | `/properties/:id/photos/:pid` | Borrar una foto                                                   |
| DELETE | `/properties/:id`             | Borrado lógico (sólo admin)                                       |

## Criterios de aceptación → tests

| Criterio                                                         | Dónde                                                                             |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Alta válida → 201 y `AVAILABLE`                                  | `test/properties.e2e-spec.ts`                                                     |
| Alta sin dirección → 400                                         | `test/properties.e2e-spec.ts`                                                     |
| Foto 21 → 400 (y no sube nada)                                   | `test/properties.e2e-spec.ts`                                                     |
| Filtro por estado; búsqueda parcial por dirección                | `test/properties.e2e-spec.ts`                                                     |
| Alquilada a mano sin contrato: permitido                         | `test/properties.e2e-spec.ts`                                                     |
| A disponible con contrato activo: 409; borrar con historial: 409 | `property.policy.spec.ts` (hasta la Fase 9 no hay contratos para probarlo en e2e) |
| Aislamiento entre inmobiliarias, también por id                  | `test/properties.e2e-spec.ts`                                                     |
| Subida que falla a mitad → sin estado inconsistente              | `add-property-photos.handler.spec.ts`                                             |

Totales: 228 unitarios y 129 e2e (12 suites).

## Pendiente

- **Fase 7**: validar `ownerId` contra el módulo de propietarios (hoy se acepta cualquier UUID o null; el front todavía no lo manda).
- **Fase 9**: reemplazar `NoContractsYet` y exponer una facade para que los contratos cambien el estado de la propiedad.
- **Fase 22**: listado público (sólo `AVAILABLE`, sin notas).
- Reordenar fotos (opcional en la spec): hoy la principal es la primera que se subió.
