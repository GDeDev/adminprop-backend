# Fase 5 — Maestros (backend)

Spec: `adminprop-repo-files/specs/fase-05-maestros.md`. Rama `feature/fase-05-maestros`, **encadenada sobre `feature/fase-04-auth`**: se mergea después del PR de la Fase 4.

Hecha **sin supervisión**. Decisiones para revisar: [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md), D-26 a D-30. La principal: los maestros son **por inmobiliaria** (una tabla por maestro con `tenant_id`), no globales como sugería la spec (D-26).

## Qué quedó construido

### Tablas (migración `add_master_data`)

| Tabla             | Campos propios                                            | Únicos (sin mayúsculas)     |
| ----------------- | --------------------------------------------------------- | --------------------------- |
| `locations`       | `level` (COUNTRY/PROVINCE/CITY/NEIGHBORHOOD), `parent_id` | por (tenant, padre, nombre) |
| `property_types`  | —                                                         | por (tenant, nombre)        |
| `amenities`       | `icon` (nombre de ícono de lucide)                        | por (tenant, nombre)        |
| `operation_types` | —                                                         | por (tenant, nombre)        |
| `service_types`   | —                                                         | por (tenant, nombre)        |

Todas con `tenant_id`, `name`, `is_active`, timestamps y autor. Filtradas por tenant y auditadas (`auditable-models.ts`). Sin borrado: `is_active = false`.

### Módulo `src/modules/master-data`

| Pieza                  | Dónde                                                                                                                                                       |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Reglas puras (+ tests) | `domain/master-data.policy.ts`: nombres, jerarquía, armado del árbol                                                                                        |
| Excepciones            | `domain/master-data.exceptions.ts`                                                                                                                          |
| Maestros planos        | un solo set de commands/queries con `catalog` como parámetro; `CatalogRepositoryImpl` con una interfaz común para los cuatro delegates de Prisma, sin casts |
| Controllers planos     | `CatalogController` abstracto + 4 subclases (amenities agrega el ícono)                                                                                     |
| Ubicaciones            | `location.*` commands/queries, `LocationsController`                                                                                                        |
| Facade para la Fase 6  | `MasterDataFacade.areSelectable()` y `isSelectableLocation()`                                                                                               |

### Endpoints

Para cada maestro plano (`property-types`, `amenities`, `operation-types`, `service-types`):

| Método | Ruta                                   | Quién            |
| ------ | -------------------------------------- | ---------------- |
| GET    | `/<maestro>?isActive=true\|false\|all` | admin y empleado |
| GET    | `/<maestro>/:id`                       | admin y empleado |
| POST   | `/<maestro>`                           | admin            |
| PATCH  | `/<maestro>/:id`                       | admin            |
| PATCH  | `/<maestro>/:id/deactivate`            | admin            |
| PATCH  | `/<maestro>/:id/activate`              | admin            |

Ubicaciones: `GET /locations?level=&parentId=&isActive=`, `GET /locations/tree`, `GET /locations/:id`, `POST /locations`, `PATCH /locations/:id` (renombrar), `PATCH /locations/:id/deactivate` y `/activate`.

### Catálogo base

- `prisma/lib/master-data-seed.ts`, idempotente. Tipos de propiedad (Casa, Departamento, PH, Local, Oficina, Terreno), de operación (Alquiler, Venta, Temporario), de servicio (Alquiler, Expensas, Luz, Gas, Agua, Municipal, Seguro), amenities con ícono (Pileta, Cochera, Parrilla, Balcón, Terraza, Ascensor) y Argentina con Buenos Aires y CABA.
- Lo carga `tenant:create` en la transacción del alta. El seed de demo agrega La Plata, Quilmes y CABA con barrios.
- `npm run master-data:seed [-- --slug x]` completa las inmobiliarias previas.

## Criterios de aceptación → tests

| Criterio (spec 7)                                           | Test                           |
| ----------------------------------------------------------- | ------------------------------ |
| Seed carga los maestros base sin errores (y es idempotente) | `test/master-data.e2e-spec.ts` |
| `GET /locations/tree` devuelve la jerarquía anidada         | `test/master-data.e2e-spec.ts` |
| Barrio sin `parent_id` → 400                                | `test/master-data.e2e-spec.ts` |
| Desactivar un tipo lo saca de `?isActive=true` sin fallar   | `test/master-data.e2e-spec.ts` |
| Empleado no crea ni edita → 403                             | `test/master-data.e2e-spec.ts` |
| Nombre duplicado en el mismo nivel → 409                    | `test/master-data.e2e-spec.ts` |
| Reactivar con el padre desactivado se permite               | `test/master-data.e2e-spec.ts` |
| Aislamiento: otra inmobiliaria no ve ni toca, ni por id     | `test/master-data.e2e-spec.ts` |
| Jerarquía y árbol (reglas puras)                            | `master-data.policy.spec.ts`   |

"Desactivar un tipo con propiedades asociadas" se prueba sin propiedades: todavía no existen (Fase 6). No hay FK que lo impida y el registro nunca se borra.

Totales: 212 unitarios y 115 e2e (11 suites), en verde.

## Pendiente

- Fase 6: validar con `MasterDataFacade` al dar de alta una propiedad (tipo, ubicación y amenities activos).
- Fase 21: importar las ubicaciones reales desde Tokko.
