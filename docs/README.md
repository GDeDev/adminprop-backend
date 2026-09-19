# Documentación

## Empezar

Arranque, scripts y estructura del proyecto: **[README principal](../README.md)**.

## Fases

| Fase             | Técnica                                  | Funcional                                    |
| ---------------- | ---------------------------------------- | -------------------------------------------- |
| 1 — Arquitectura | [tecnica/fase-01.md](tecnica/fase-01.md) | [funcional/fase-01.md](funcional/fase-01.md) |

Decisiones técnicas que las specs no resolvían: [DECISIONES_TECNICAS.md](DECISIONES_TECNICAS.md).

## Guías

| Doc                                                      | Sobre                                                          |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| [FEATURE-FLAGS.md](FEATURE-FLAGS.md)                     | Feature flags por tenant (Flagsmith) y EmailPort               |
| [STORAGE.md](STORAGE.md)                                 | Archivos: StoragePort, local y Cloudinary, carpetas por tenant |
| [ASYNC-JOBS.md](ASYNC-JOBS.md)                           | Acciones pesadas: 202 + AsyncJob + GET /jobs/:id/status        |
| [QUEUE.md](QUEUE.md)                                     | Cola de trabajos: pg-boss, reintentos, dead-letter, tenant     |
| [MULTI-TENANCY.md](MULTI-TENANCY.md)                     | Aislamiento por inmobiliaria, runInTenant, prisma.unscoped     |
| [AUTH.md](AUTH.md)                                       | Autenticación: flujo, guards, roles, decisiones de seguridad   |
| [ERROR-HANDLING.md](ERROR-HANDLING.md)                   | Formato de errores, códigos, filtros y redacción de logs       |
| [CONFIGURATION.md](CONFIGURATION.md)                     | Variables de entorno, config tipada y secretos                 |
| [RATE-LIMITING.md](RATE-LIMITING.md)                     | Throttling, perfiles y storage compartido                      |
| [AUDIT-SOFT-DELETE.md](AUDIT-SOFT-DELETE.md)             | Historial de cambios y borrado lógico                          |
| [PAGINATION.md](PAGINATION.md)                           | Cómo paginar un listado, con Prisma y en Swagger               |
| [ENV-SECURITY-NOTICE.md](ENV-SECURITY-NOTICE.md)         | Qué hacer y qué no con los secretos                            |
| [ADVANCED-LOGGING-SYSTEM.md](ADVANCED-LOGGING-SYSTEM.md) | Logger estructurado                                            |
| [CORRELATION-ID-HANDLING.md](CORRELATION-ID-HANDLING.md) | Trazabilidad de requests                                       |

## Desarrollo

| Doc                                | Sobre                                     |
| ---------------------------------- | ----------------------------------------- |
| [DEBUGGING.md](DEBUGGING.md)       | Debug en VS Code, tests y troubleshooting |
| [VSCODE-SETUP.md](VSCODE-SETUP.md) | Configuración de VS Code                  |
| [FORMATTING.md](FORMATTING.md)     | Prettier, ESLint y hooks de git           |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Convenciones del repositorio              |

## Convenciones

Cómo agregar un feature, el estilo de errores y el resto de las reglas del
repositorio están en [`CLAUDE.md`](../CLAUDE.md), en la raíz.
