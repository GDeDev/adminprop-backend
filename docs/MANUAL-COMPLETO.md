# 🚀 Manual Completo: Template NestJS API

> **Template de GitHub** para crear APIs empresariales con NestJS, arquitectura hexagonal, CQRS, Prisma ORM, MariaDB e integración con AWS.

## 📋 Tabla de Contenidos

1. [Qué Incluye este Template](#-qué-incluye-este-template)
2. [Crear Proyecto desde Template](#-crear-proyecto-desde-template)
3. [Configuración Inicial](#-configuración-inicial)
4. [Estructura del Proyecto](#-estructura-del-proyecto)
5. [Guías de Desarrollo](#-guías-de-desarrollo)
6. [Despliegue](#-despliegue)
7. [Solución de Problemas](#-solución-de-problemas)
8. [Contribuir](#-contribuir)

---

## 🎯 Qué Incluye este Template

### ✅ Arquitectura y Patrones

- **Arquitectura Hexagonal** (Clean Architecture)
- **CQRS** (Command Query Responsibility Segregation)
- **Result Pattern** para manejo consistente de errores
- **Domain-Driven Design** (DDD)
- **Dependency Injection** con NestJS

### ✅ Base de Datos y ORM

- **MariaDB** como base de datos principal
- **Prisma ORM** con type safety completo
- **Migraciones** automáticas
- **Connection pooling** configurado
- **Query optimization** incluida

### ✅ API y Documentación

- **RESTful API** con versionado
- **Swagger/OpenAPI** documentación automática
- **Validación** con class-validator
- **Transformación** de request/response
- **Manejo global** de excepciones
- **Logging** y monitoring

### ✅ Seguridad y Configuración

- **AWS Secrets Manager** integración
- **Configuración** basada en entornos
- **CORS** configurado
- **Rate limiting** preparado
- **JWT Authentication** estructura

### ✅ Experiencia de Desarrollo

- **Hot reload** para desarrollo
- **VS Code** integración completa
- **TypeScript** configuración estricta
- **ESLint + Prettier + Husky**
- **Git hooks** pre-commit
- **Testing** unitario y E2E
- **Coverage** reporting

### ✅ DevOps y Despliegue

- **Docker** multi-stage builds
- **Docker Compose** para desarrollo
- **GitHub Actions** CI/CD
- **AWS ECS** deployment ready
- **Environment** management
- **Health checks**

---

## 🚀 Crear Proyecto desde Template

### Método 1: GitHub Web Interface (Recomendado)

1. **Ir al repositorio template** en GitHub
2. **Click en "Use this template"** (botón verde)
3. **Click en "Create a new repository"**
4. **Configurar el nuevo repositorio:**
   - Repository name: `mi-nueva-api`
   - Description: Descripción de tu API
   - Visibility: Public o Private
5. **Click en "Create repository from template"**

### Método 2: GitHub CLI

```bash
# Instalar GitHub CLI (si no lo tienes)
# macOS: brew install gh
# Windows: choco install gh
# Linux: https://cli.github.com/

# Crear repositorio desde template
gh repo create mi-nueva-api --template Grupo-Centaurus/vulcan-nest-api-template --public

# Clonar y navegar
gh repo clone mi-nueva-api
cd mi-nueva-api
```

### Método 3: Descarga Manual

```bash
# Descargar template
curl -L https://github.com/Grupo-Centaurus/vulcan-nest-api-template/archive/main.zip -o template.zip

# Extraer y configurar
unzip template.zip
mv nestjs-api-template-main mi-nueva-api
cd mi-nueva-api

# Inicializar git
rm -rf .git
git init
git add .
git commit -m "Initial commit from NestJS API template"
```

---

## ⚙️ Configuración Inicial

### Paso 1: Ejecutar Script de Configuración

```bash
# Linux/macOS
./scripts/init-template.sh

# Windows
scripts\init-template.bat
```

El script te pedirá:

- **Nombre del proyecto** (sin espacios)
- **Descripción del proyecto**
- **Nombre del autor**
- **Email del autor**
- **Username de GitHub**
- **Nombre de la base de datos**

### Paso 2: Instalar Dependencias

```bash
npm install
```

### Paso 3: Configurar Variables de Entorno

```bash
# El script ya creó .env, pero revisa y ajusta:
nano .env

# Variables principales:
DATABASE_URL="mysql://root:password@localhost:3306/tu_db"
JWT_SECRET="tu-jwt-secret-generado"
NODE_ENV="development"
PORT=3000

# AWS (opcional para desarrollo local)
AWS_REGION="us-east-1"
AWS_SECRETS_MANAGER_ENDPOINT=""
```

### Paso 4: Iniciar Base de Datos

```bash
# Con Docker (recomendado)
npm run docker:dev

# O configurar tu propia MariaDB/MySQL
# DATABASE_URL="mysql://usuario:password@host:puerto/database"
```

### Paso 5: Configurar Prisma

```bash
# Generar cliente Prisma
npm run prisma:generate

# Ejecutar migraciones
npm run prisma:migrate

# (Opcional) Poblar con datos de ejemplo
npm run prisma:seed
```

### Paso 6: Iniciar Aplicación

```bash
# Desarrollo con hot reload
npm run start:dev

# La API estará disponible en:
# http://localhost:3000
# Swagger UI: http://localhost:3000/api
```

---

## 📁 Estructura del Proyecto

```
mi-nueva-api/
├── .github/                    # GitHub templates y workflows
│   ├── workflows/             # CI/CD pipelines
│   ├── ISSUE_TEMPLATE/        # Templates para issues
│   └── pull_request_template.md
├── docs/                      # Documentación del proyecto
│   ├── DEBUGGING.md          # Guía de debugging
│   ├── VSCODE-SETUP.md       # Configuración VS Code
│   └── FORMATTING.md         # Guías de formato
├── prisma/                   # Schema y migraciones DB
│   ├── schema.prisma        # Definición del schema
│   ├── migrations/          # Archivos de migración
│   └── seed.ts             # Datos de ejemplo
├── src/                     # Código fuente
│   ├── application/         # Capa de aplicación (CQRS)
│   │   ├── handlers/       # Command/Query handlers
│   │   ├── commands/       # Comandos
│   │   └── queries/        # Consultas
│   ├── domain/             # Lógica de negocio
│   │   ├── entities/       # Entidades de dominio
│   │   ├── repositories/   # Interfaces de repositorios
│   │   └── services/       # Servicios de dominio
│   ├── infrastructure/     # Capa de infraestructura
│   │   ├── database/       # Configuración DB
│   │   ├── repositories/   # Implementación repositorios
│   │   └── services/       # Servicios externos
│   ├── presentation/       # Capa de presentación
│   │   ├── controllers/    # Controllers REST
│   │   ├── dto/           # Data Transfer Objects
│   │   └── filters/       # Exception filters
│   └── shared/            # Código compartido
│       ├── config/        # Configuración
│       ├── types/         # Tipos TypeScript
│       └── utils/         # Utilidades
├── test/                   # Tests
│   ├── unit/              # Tests unitarios
│   ├── integration/       # Tests de integración
│   └── e2e/              # Tests end-to-end
├── scripts/               # Scripts de utilidad
│   ├── init-template.sh   # Script configuración Linux/Mac
│   └── init-template.bat  # Script configuración Windows
├── docker-compose.yml     # Configuración Docker desarrollo
├── Dockerfile            # Imagen Docker producción
├── package.json          # Dependencias y scripts
└── README.md             # Este archivo
```

---

## 📚 Guías de Desarrollo

### Crear un Nuevo Endpoint

1. **Definir la entidad** en `src/domain/entities/`
2. **Crear el repositorio** interface en `src/domain/repositories/`
3. **Implementar repositorio** en `src/infrastructure/repositories/`
4. **Crear comando/query** en `src/application/commands/` o `queries/`
5. **Crear handler** en `src/application/handlers/`
6. **Crear DTO** en `src/presentation/dto/`
7. **Crear controller** en `src/presentation/controllers/`
8. **Añadir tests** en `test/unit/` y `test/e2e/`

### Ejemplo: Agregar entidad "Product"

```typescript
// 1. src/domain/entities/product.entity.ts
export class Product {
  constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly price: number,
    public readonly description?: string,
  ) {}
}

// 2. src/domain/repositories/product.repository.ts
export interface ProductRepository {
  findById(id: string): Promise<Product | null>
  save(product: Product): Promise<void>
  delete(id: string): Promise<void>
}

// 3. src/application/commands/create-product.command.ts
export class CreateProductCommand {
  constructor(
    public readonly name: string,
    public readonly price: number,
    public readonly description?: string,
  ) {}
}

// 4. src/application/handlers/create-product.handler.ts
@CommandHandler(CreateProductCommand)
export class CreateProductHandler {
  constructor(private productRepository: ProductRepository) {}

  async execute(command: CreateProductCommand): Promise<Result<Product>> {
    // Lógica del handler
  }
}
```

### Testing

```bash
# Ejecutar todos los tests
npm test

# Tests unitarios únicamente
npm run test:unit

# Tests E2E
npm run test:e2e

# Coverage report
npm run test:cov

# Tests en modo watch
npm run test:watch
```

### Code Quality

```bash
# Verificar formato y linting
npm run code:check

# Arreglar formato y linting automáticamente
npm run code:fix

# Solo formatear
npm run format

# Solo linting
npm run lint
```

---

## 🚀 Despliegue

### Docker Local

```bash
# Build imagen
docker build -t mi-api .

# Ejecutar contenedor
docker run -p 3000:3000 -e NODE_ENV=production mi-api

# Con docker-compose (incluye base de datos)
docker-compose -f docker-compose.prod.yml up
```

### AWS ECS

1. **Configurar AWS CLI**

```bash
aws configure
```

2. **Build y push a ECR**

```bash
# Crear repositorio ECR
aws ecr create-repository --repository-name mi-api

# Login a ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account-id>.dkr.ecr.us-east-1.amazonaws.com

# Build y tag
docker build -t mi-api .
docker tag mi-api:latest <account-id>.dkr.ecr.us-east-1.amazonaws.com/mi-api:latest

# Push
docker push <account-id>.dkr.ecr.us-east-1.amazonaws.com/mi-api:latest
```

3. **Configurar ECS Task Definition**
4. **Crear ECS Service**
5. **Configurar Load Balancer**

### CI/CD con GitHub Actions

El template incluye workflows en `.github/workflows/`:

- **ci.yml**: Tests y quality checks en PRs
- **cd.yml**: Deploy automático en merge a main
- **security.yml**: Escaneo de vulnerabilidades

Variables necesarias en GitHub Secrets:

```
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
ECR_REPOSITORY
ECS_CLUSTER_NAME
ECS_SERVICE_NAME
```

---

## 🔧 Solución de Problemas

### Error: Cannot connect to database

```bash
# Verificar que Docker esté corriendo
docker ps

# Reiniciar servicios
npm run docker:dev

# Verificar variables de entorno
cat .env | grep DATABASE_URL
```

### Error: Prisma client not generated

```bash
# Regenerar cliente Prisma
npm run prisma:generate

# Si persiste, limpiar y reinstalar
rm -rf node_modules
npm install
npm run prisma:generate
```

### Error: Port 3000 already in use

```bash
# Cambiar puerto en .env
PORT=3001

# O terminar proceso que usa el puerto
lsof -ti:3000 | xargs kill -9
```

### Tests fallan

```bash
# Ejecutar tests en modo verbose
npm test -- --verbose

# Verificar configuración Jest
cat jest.config.js

# Limpiar cache de Jest
npm test -- --clearCache
```

### Problemas con VS Code

Ver la guía detallada en [`docs/VSCODE-SETUP.md`](docs/VSCODE-SETUP.md)

### Problemas con ESLint/Prettier

Ver la guía detallada en [`docs/FORMATTING.md`](docs/FORMATTING.md)

### Debugging

Ver la guía detallada en [`docs/DEBUGGING.md`](docs/DEBUGGING.md)

---

## 🤝 Contribuir

### Reportar Bugs

Usa el template de issue "Bug Report" en GitHub.

### Solicitar Features

Usa el template de issue "Feature Request" en GitHub.

### Contribuir Código

1. Fork el repositorio
2. Crear branch: `git checkout -b feature/mi-feature`
3. Commit cambios: `git commit -m 'Add mi-feature'`
4. Push branch: `git push origin feature/mi-feature`
5. Crear Pull Request usando el template

### Guidelines

- Seguir la arquitectura hexagonal existente
- Añadir tests para nuevo código
- Actualizar documentación si es necesario
- Seguir las convenciones de código (ESLint/Prettier)

---

## 📄 Licencia

Este template está bajo licencia MIT. Ver `LICENSE` para más detalles.

---

## 🙏 Agradecimientos

- NestJS team por el excelente framework
- Prisma team por el ORM
- Comunidad open source por las librerías utilizadas

---

## 📞 Soporte

- 📖 **Documentación**: Ver archivos en `docs/`
- 🐛 **Bugs**: [Crear issue](../../issues/new?template=bug_report.md)
- 💡 **Features**: [Crear issue](../../issues/new?template=feature_request.md)
- ❓ **Preguntas**: [Crear issue](../../issues/new?template=template_support.md)

---

**¡Happy coding! 🚀**
