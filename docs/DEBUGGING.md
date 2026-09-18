# Debugging and Testing Guide

Esta guía explica cómo usar las configuraciones de debugging y testing en VS Code para el proyecto de API.

## 🐛 Configuraciones de Debug

### 1. Debug API (Development)

- **Uso**: Para debuggear la API en modo desarrollo
- **Puerto**: Usa ts-node para ejecutar directamente TypeScript
- **Variables**: Lee `.env` por defecto
- **Pre-launch**: Compila automáticamente el proyecto

### 2. Debug API (QA)

- **Uso**: Para debuggear la API en entorno QA
- **Puerto**: Ejecuta desde `dist/main.js` compilado
- **Variables**: Lee `.env.qa`
- **Pre-launch**: Compila automáticamente el proyecto

### 3. Debug API (Production)

- **Uso**: Para debuggear la API en entorno de producción
- **Puerto**: Ejecuta desde `dist/main.js` compilado
- **Variables**: Lee `.env.production`
- **Pre-launch**: Compila automáticamente el proyecto

### 4. Attach to Running API

- **Uso**: Se conecta a una API que ya está ejecutándose
- **Puerto**: 9229 (debug port)
- **Útil**: Para debuggear APIs ejecutándose en Docker

### 5. Debug Unit Tests

- **Uso**: Debuggear tests unitarios específicos
- **Configuración**: Ejecuta Jest en modo debug
- **Breakpoints**: Permite breakpoints en tests y código

### 6. Debug E2E Tests

- **Uso**: Debuggear tests end-to-end
- **Configuración**: Usa jest-e2e.json
- **Breakpoints**: Permite debuggear flujos completos

### 7. Debug Current Test File

- **Uso**: Debuggear solo el archivo de test actual
- **Funcionamiento**: Usa `${relativeFile}` para el archivo abierto
- **Útil**: Para debuggear tests específicos

## 🔧 Tareas de VS Code

### Build y Desarrollo

- **Build Application**: Compila el proyecto
- **Start Development Server**: Inicia en modo desarrollo con watch
- **Start Debug Server**: Inicia con debugging habilitado
- **Start QA Server**: Inicia en modo QA
- **Start Production Server**: Inicia en modo producción

### Testing

- **Run Unit Tests**: Ejecuta todos los tests unitarios
- **Run Tests with Coverage**: Ejecuta tests y genera reporte de cobertura
- **Run Tests in Watch Mode**: Ejecuta tests en modo watch
- **Run E2E Tests**: Ejecuta tests end-to-end
- **Generate Test Coverage Report**: Genera reporte detallado de cobertura
- **Open Coverage Report**: Abre el reporte de cobertura en el navegador

### Docker

- **Docker: Start Development**: Inicia servicios de desarrollo
- **Docker: Start Production**: Inicia servicios de producción
- **Docker: Stop Services**: Detiene todos los servicios

### Prisma

- **Prisma: Generate Client**: Genera el cliente de Prisma
- **Prisma: Run Migrations**: Ejecuta migraciones de base de datos
- **Prisma: Open Studio**: Abre Prisma Studio

## 📊 Cobertura de Tests

### Configuración de Cobertura

```json
{
  "coverageThreshold": {
    "global": {
      "branches": 70,
      "functions": 70,
      "lines": 70,
      "statements": 70
    }
  }
}
```

### Archivos Excluidos de Cobertura

- `*.spec.ts` - Tests unitarios
- `*.e2e-spec.ts` - Tests E2E
- `main.ts` - Punto de entrada
- `*.module.ts` - Módulos de NestJS
- `*.interface.ts` - Interfaces TypeScript
- `*.dto.ts` - Data Transfer Objects

### Reportes Generados

- **HTML**: `coverage/lcov-report/index.html`
- **LCOV**: `coverage/lcov.info`
- **JSON**: `coverage/coverage-final.json`
- **Text**: Salida en consola

## 🚀 Cómo Usar

### 1. Debuggear la API

1. Abrir VS Code
2. Ir a la pestaña "Run and Debug" (Ctrl+Shift+D)
3. Seleccionar "Debug API (Development)"
4. Presionar F5 o hacer click en "Start Debugging"
5. Colocar breakpoints en el código
6. Hacer requests a la API

### 2. Debuggear Tests

1. Abrir el archivo de test que quieres debuggear
2. Colocar breakpoints en el test o código
3. Seleccionar "Debug Current Test File"
4. Presionar F5

### 3. Generar Reporte de Cobertura

1. Ejecutar tarea "Generate Test Coverage Report"
2. O usar comando: `npm run test:cov`
3. Abrir `coverage/lcov-report/index.html`

### 4. Debuggear con Docker

1. Iniciar servicios: `npm run docker:dev`
2. Usar "Attach to Running API" para conectarse
3. Asegurar que el puerto 9229 esté expuesto

## 🔨 Comandos NPM

### Desarrollo

```bash
npm run start:dev      # Desarrollo con watch
npm run start:debug    # Desarrollo con debug
npm run start:qa       # Entorno QA
npm run start:production # Entorno producción
```

### Testing

```bash
npm run test           # Tests unitarios
npm run test:watch     # Tests en modo watch
npm run test:cov       # Tests con cobertura
npm run test:e2e       # Tests E2E
npm run test:unit      # Solo tests unitarios
npm run test:cov:open  # Cobertura + abrir reporte
```

## 🌍 Variables de Entorno

### Desarrollo (.env)

- `NODE_ENV=development`
- Configuración local de desarrollo

### QA (.env.qa)

- `NODE_ENV=qa`
- Base de datos de QA
- Configuración de testing

### Producción (.env.production)

- `NODE_ENV=production`
- Configuración optimizada
- Swagger deshabilitado

## 💡 Tips y Trucos

### 1. Breakpoints Condicionales

- Click derecho en breakpoint → "Edit Breakpoint"
- Agregar condición: `user.id === 1`

### 2. Watch Variables

- En debug, agregar variables al panel "Watch"
- Monitorear valores en tiempo real

### 3. Debug Console

- Usar para evaluar expresiones durante debug
- Acceder a variables y funciones

### 4. Source Maps

- Configuración automática para TypeScript
- Debugging directo en archivos .ts

### 5. Hot Reload

- Modificaciones se reflejan automáticamente
- No necesario reiniciar debug session

## 🚨 Troubleshooting

### Error: Puerto en Uso

```bash
# Encontrar proceso
lsof -ti:3000
# Matar proceso
kill -9 <PID>
```

### Error: Base de Datos

```bash
# Verificar servicios Docker
docker-compose ps
# Reiniciar servicios
npm run docker:down && npm run docker:dev
```

### Error: Source Maps

- Verificar `tsconfig.json` tiene `"sourceMap": true`
- Compilar proyecto: `npm run build`

### Tests No Encuentran Módulos

- Verificar `tsconfig.json` paths
- Ejecutar `npm run prisma:generate`
