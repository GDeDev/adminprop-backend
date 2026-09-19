# 🤝 Contributing to NestJS API Template

¡Gracias por tu interés en contribuir a este template de NestJS! Este documento te guiará sobre cómo contribuir efectivamente.

## 📋 Tabla de Contenidos

1. [Code of Conduct](#code-of-conduct)
2. [¿Cómo Contribuir?](#cómo-contribuir)
3. [Reportar Bugs](#reportar-bugs)
4. [Sugerir Features](#sugerir-features)
5. [Desarrollo Local](#desarrollo-local)
6. [Pull Requests](#pull-requests)
7. [Convenciones de Código](#convenciones-de-código)
8. [Estructura del Proyecto](#estructura-del-proyecto)

## Code of Conduct

Este proyecto adhiere al [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Al participar, se espera que respetes este código.

## ¿Cómo Contribuir?

Hay muchas formas de contribuir a este template:

### 🐛 Reportar Bugs

- Usa el [template de bug report](.github/ISSUE_TEMPLATE/bug_report.md)
- Incluye información detallada sobre el problema
- Proporciona pasos para reproducir el bug
- Incluye información del entorno (OS, Node.js version, etc.)

### 💡 Sugerir Features

- Usa el [template de feature request](.github/ISSUE_TEMPLATE/feature_request.md)
- Explica claramente el problema que resuelve
- Describe la solución propuesta
- Considera alternativas

### 📖 Mejorar Documentación

- Corrige errores tipográficos
- Mejora claridad en las explicaciones
- Añade ejemplos faltantes
- Traduce contenido

### 🔧 Contribuir Código

- Implementa nuevas features
- Corrige bugs
- Mejora rendimiento
- Añade tests

## Reportar Bugs

Antes de reportar un bug:

1. **Busca issues existentes** para evitar duplicados
2. **Reproduce el bug** en la última versión
3. **Verifica** que no sea un problema de configuración

Al reportar:

- Usa el template de bug report
- Incluye logs de error completos
- Proporciona un ejemplo mínimo reproducible
- Especifica el entorno de desarrollo

## Sugerir Features

Para sugerir nuevas características:

1. **Busca** si ya existe una sugerencia similar
2. **Considera** si encaja con el propósito del template
3. **Piensa** en la implementación y mantenimiento

Guías para features:

- Debe ser útil para la mayoría de usuarios
- Debe seguir las mejores prácticas
- Debe ser mantenible a largo plazo
- Debe incluir documentación

## Desarrollo Local

### Setup Inicial

```bash
# Fork y clonar el repositorio
git clone https://github.com/Grupo-Centaurus/vulcan-nest-api-template.git
cd nestjs-api-template

# Instalar dependencias
npm install

# Configurar entorno: las variables salen de Doppler, no de un .env
doppler login
doppler setup   # config dev_backend

# Iniciar base de datos
npm run docker:dev

# Configurar Prisma
npm run prisma:generate
npm run prisma:migrate

# Ejecutar en modo desarrollo
npm run start:dev
```

### Scripts Útiles

```bash
# Tests
npm test                    # Todos los tests
npm run test:unit          # Tests unitarios
npm run test:e2e           # Tests E2E
npm run test:cov           # Coverage report

# Calidad de código
npm run code:check         # Verificar formato y linting
npm run code:fix           # Arreglar automáticamente
npm run lint               # Solo ESLint
npm run format             # Solo Prettier

# Base de datos
npm run prisma:studio      # Abrir Prisma Studio
npm run prisma:reset       # Reset completo DB
npm run prisma:seed        # Poblar con datos

# Docker
npm run docker:dev         # DB para desarrollo
npm run docker:prod        # Build imagen producción
```

### Testing

Asegúrate de que todos los tests pasen:

```bash
# Antes de hacer commit
npm run code:check
npm test
```

Los tests deben:

- Cubrir nuevas funcionalidades
- Mantener o mejorar el coverage
- Ser rápidos y confiables
- Seguir las convenciones existentes

## Pull Requests

### Proceso

1. **Fork** el repositorio
2. **Crear branch** desde `main`:
   ```bash
   git checkout -b feature/mi-nueva-feature
   # o
   git checkout -b fix/mi-bug-fix
   ```
3. **Hacer commits** descriptivos
4. **Push** tu branch
5. **Crear PR** usando el template

### Naming Conventions

**Branches:**

- `feature/nombre-descriptivo` - Nuevas características
- `fix/nombre-del-bug` - Corrección de bugs
- `docs/mejora-documentacion` - Mejoras en documentación
- `refactor/nombre-refactor` - Refactoring
- `test/mejora-tests` - Mejoras en testing

**Commits:**

```bash
# Formato
tipo(scope): descripción breve

# Ejemplos
feat(auth): add JWT token refresh functionality
fix(database): resolve connection pool timeout
docs(readme): update installation instructions
test(users): add unit tests for user service
refactor(handlers): simplify error handling logic
```

### Checklist PR

- [ ] Tests pasan localmente
- [ ] Código sigue las convenciones del proyecto
- [ ] Documentación actualizada si es necesario
- [ ] Sin warnings de ESLint/TypeScript
- [ ] Coverage de tests mantenido/mejorado
- [ ] PR template completado
- [ ] Commits son descriptivos

## Convenciones de Código

### TypeScript

```typescript
// ✅ Correcto
export class UserService {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly logger: Logger,
  ) {}

  async createUser(userData: CreateUserDto): Promise<Result<User>> {
    // Implementation
  }
}

// ❌ Incorrecto
export class userService {
  constructor(
    private userRepository,
    private logger,
  ) {}

  createUser(userData) {
    // Implementation
  }
}
```

### Naming

- **Classes**: PascalCase (`UserService`, `CreateUserHandler`)
- **Variables/Functions**: camelCase (`userId`, `createUser`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRY_ATTEMPTS`)
- **Files**: kebab-case (`user.service.ts`, `create-user.handler.ts`)
- **Interfaces**: PascalCase con `I` prefix opcional (`UserRepository`)

### Estructura de Archivos

```typescript
// Orden de imports
import { Injectable } from '@nestjs/common' // 1. External libraries
import { Logger } from '@nestjs/common'

import { UserRepository } from '../domain/repositories' // 2. Internal imports
import { User } from '../domain/entities'
import { Result } from '../shared/types' // 3. Shared/common

// Orden en clases
@Injectable()
export class UserService {
  // 1. Properties
  private readonly logger = new Logger(UserService.name)

  // 2. Constructor
  constructor(private readonly userRepository: UserRepository) {}

  // 3. Public methods
  async createUser(): Promise<Result<User>> {}

  // 4. Private methods
  private validateUser(): boolean {}
}
```

### Error Handling

```typescript
// ✅ Usar Result pattern
async createUser(userData: CreateUserDto): Promise<Result<User>> {
  try {
    const user = new User(userData);
    await this.userRepository.save(user);
    return Result.ok(user);
  } catch (error) {
    return Result.fail(`Failed to create user: ${error.message}`);
  }
}

// ❌ No hacer throw directo en handlers
async createUser(userData: CreateUserDto): Promise<User> {
  throw new Error('Something went wrong'); // Evitar
}
```

## Estructura del Proyecto

Respeta la arquitectura hexagonal:

```
src/
├── application/          # Casos de uso, CQRS handlers
├── domain/              # Entidades, reglas de negocio
├── infrastructure/      # Implementaciones técnicas
├── presentation/        # Controllers, DTOs
└── shared/             # Código compartido
```

### Reglas Arquitecturales

1. **Domain** no debe importar de otras capas
2. **Application** puede importar de Domain
3. **Infrastructure** puede importar de Domain y Application
4. **Presentation** puede importar de Application y Domain
5. **Shared** puede ser importado por cualquier capa

### Añadir Nuevas Features

Sigue este orden:

1. **Domain**: Entidades, Value Objects, Interfaces
2. **Application**: Commands/Queries, Handlers
3. **Infrastructure**: Implementaciones de repositorios
4. **Presentation**: Controllers, DTOs
5. **Tests**: Unitarios e integración

## Releases

El proyecto usa [Semantic Versioning](https://semver.org/):

- **MAJOR**: Cambios que rompen compatibilidad
- **MINOR**: Nuevas funcionalidades compatibles
- **PATCH**: Bug fixes compatibles

### Changelog

Mantén actualizado el CHANGELOG.md con:

- Nuevas features
- Bug fixes
- Breaking changes
- Mejoras de rendimiento

## Preguntas

Si tienes preguntas:

1. **Revisa** la documentación en `docs/`
2. **Busca** en issues existentes
3. **Pregunta** en GitHub Discussions
4. **Crea** un issue con el template de soporte

## Agradecimientos

¡Gracias por contribuir! Tu ayuda hace que este template sea mejor para toda la comunidad.

---

**Happy contributing! 🚀**
