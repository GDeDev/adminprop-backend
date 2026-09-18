# Documentación

## Empezar

Arranque, scripts y estructura del proyecto: **[README principal](../README.md)**.

## Guías del template

| Doc                                                      | Sobre                                                        |
| -------------------------------------------------------- | ------------------------------------------------------------ |
| [AUTH.md](AUTH.md)                                       | Autenticación: flujo, guards, roles, decisiones de seguridad |
| [ERROR-HANDLING.md](ERROR-HANDLING.md)                   | Formato de errores, códigos, filtros y redacción de logs     |
| [CONFIGURATION.md](CONFIGURATION.md)                     | Variables de entorno, config tipada y secretos               |
| [RATE-LIMITING.md](RATE-LIMITING.md)                     | Throttling, perfiles y storage compartido                    |
| [ENV-SECURITY-NOTICE.md](ENV-SECURITY-NOTICE.md)         | Qué hacer y qué no con los secretos                          |
| [ADVANCED-LOGGING-SYSTEM.md](ADVANCED-LOGGING-SYSTEM.md) | Logger estructurado                                          |
| [CORRELATION-ID-HANDLING.md](CORRELATION-ID-HANDLING.md) | Trazabilidad de requests                                     |

## Desarrollo

| Doc                                | Sobre                                     |
| ---------------------------------- | ----------------------------------------- |
| [DEBUGGING.md](DEBUGGING.md)       | Debug en VS Code, tests y troubleshooting |
| [VSCODE-SETUP.md](VSCODE-SETUP.md) | Configuración de VS Code                  |
| [FORMATTING.md](FORMATTING.md)     | Prettier, ESLint y hooks de git           |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Convenciones del repositorio              |

## Uso del template

| Doc                                                        | Sobre                                   |
| ---------------------------------------------------------- | --------------------------------------- |
| [CHECKLIST.md](CHECKLIST.md)                               | Pasos para configurar un proyecto nuevo |
| [MANUAL-COMPLETO.md](MANUAL-COMPLETO.md)                   | Guía extendida                          |
| [TEMPLATE-QUICK-REFERENCE.md](TEMPLATE-QUICK-REFERENCE.md) | Referencia rápida                       |
| [GITHUB-TEMPLATE-SETUP.md](GITHUB-TEMPLATE-SETUP.md)       | Publicar el repo como GitHub template   |

> ⚠️ Los cuatro documentos de esta última sección se escribieron para la versión
> anterior del template y todavía mencionan la integración con AWS Secrets
> Manager y la librería de autenticación que se eliminaron. Ante una
> contradicción, mandan los docs de las secciones de arriba.
