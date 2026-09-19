# 🚀 VS Code Tasks and Debug Configuration Summary

Esta documentación resume todas las tareas y configuraciones de debugging que se han configurado para el proyecto API.

## ✅ **Configuraciones Completadas**

### 🔧 **Tareas de VS Code (.vscode/tasks.json)**

#### **Build y Desarrollo**

- ✅ **Build Application** - Compila el proyecto TypeScript
- ✅ **Start Development Server** - Inicia servidor de desarrollo con watch
- ✅ **Start Debug Server** - Inicia servidor con debugging habilitado
- ✅ **Start QA Server** - Inicia servidor en modo QA
- ✅ **Start Production Server** - Inicia servidor en modo producción

#### **Testing y Cobertura**

- ✅ **Run Unit Tests** - Ejecuta tests unitarios
- ✅ **Run Tests with Coverage** - Ejecuta tests y genera reporte de cobertura
- ✅ **Run Tests in Watch Mode** - Ejecuta tests en modo watch
- ✅ **Run E2E Tests** - Ejecuta tests end-to-end
- ✅ **Generate Test Coverage Report** - Genera reporte detallado de cobertura
- ✅ **Open Coverage Report** - Abre reporte de cobertura en navegador

#### **Docker**

- ✅ **Docker: Start Development** - Inicia servicios de desarrollo
- ✅ **Docker: Start Production** - Inicia servicios de producción
- ✅ **Docker: Stop Services** - Detiene todos los servicios

#### **Prisma**

- ✅ **Prisma: Generate Client** - Genera cliente de Prisma
- ✅ **Prisma: Run Migrations** - Ejecuta migraciones de BD
- ✅ **Prisma: Open Studio** - Abre Prisma Studio

### 🐛 **Configuraciones de Debug (.vscode/launch.json)**

#### **API Debugging**

- ✅ **Debug API (Development)** - Debug directo con ts-node
- ✅ **Debug API (QA)** - Debug con build compilado para QA
- ✅ **Debug API (Production)** - Debug con build compilado para producción
- ✅ **Attach to Running API** - Se conecta a API ejecutándose (Docker)

#### **Test Debugging**

- ✅ **Debug Unit Tests** - Debug de tests unitarios
- ✅ **Debug E2E Tests** - Debug de tests end-to-end
- ✅ **Debug Current Test File** - Debug del archivo de test actual

#### **Compound Configurations**

- ✅ **Debug API + Watch Tests** - Ejecuta API y tests simultáneamente

### 📁 **Variables de Entorno**

- ✅ Sin archivos `.env`: las inyecta Doppler (config `dev_backend`)

### 🧪 **Configuración de Testing**

#### **Jest Configuration**

- ✅ Configuración de cobertura con reportes HTML, LCOV, JSON
- ✅ Exclusión de archivos no relevantes para cobertura
- ✅ Setup automático con polyfills para crypto
- ✅ Thresholds de cobertura configurables (50% actualmente)

#### **Test Setup**

- ✅ **test/setup.ts** - Configuración global de tests
- ✅ Polyfill de crypto para tests
- ✅ Mock automático de variables de entorno

### 📊 **Scripts NPM Actualizados**

#### **Desarrollo**

```bash
npm run start:dev          # Desarrollo con watch
npm run start:debug        # Desarrollo con debug
npm run start:qa           # Entorno QA
npm run start:production   # Entorno producción
```

#### **Testing**

```bash
npm run test              # Tests unitarios
npm run test:watch        # Tests en modo watch
npm run test:cov          # Tests con cobertura
npm run test:e2e          # Tests E2E
npm run test:unit         # Solo tests unitarios
npm run test:cov:open     # Cobertura + abrir reporte
```

### 🎯 **Extensiones Recomendadas (.vscode/extensions.json)**

- ✅ TypeScript support
- ✅ Prettier formatter
- ✅ ESLint linting
- ✅ Jest testing
- ✅ Docker support
- ✅ Prisma support
- ✅ Git integration

## 🚀 **Cómo Usar las Configuraciones**

### **1. Debuggear la API**

1. Abrir VS Code
2. Ir a "Run and Debug" (Ctrl+Shift+D)
3. Seleccionar configuración deseada:
   - `Debug API (Development)` - Para desarrollo
   - `Debug API (QA)` - Para testing QA
   - `Debug API (Production)` - Para testing producción
4. Presionar F5 o click en "Start Debugging"
5. Colocar breakpoints según necesidad

### **2. Ejecutar Tests con Cobertura**

#### **Opción 1: Via Tareas VS Code**

1. Ctrl+Shift+P → "Tasks: Run Task"
2. Seleccionar "Run Tests with Coverage"
3. Ver resultados en terminal
4. Usar "Open Coverage Report" para ver HTML

#### **Opción 2: Via Terminal**

```bash
npm run test:cov
```

### **3. Debuggear Tests**

1. Abrir archivo de test
2. Colocar breakpoints
3. Seleccionar "Debug Current Test File"
4. Presionar F5

### **4. Docker Development**

1. Usar tarea "Docker: Start Development"
2. Para debug: usar "Attach to Running API"
3. Asegurar puerto 9229 expuesto para debug

## ✅ **Estado de Tests**

### **Tests Actuales**

- ✅ `CreateUserHandler` - 3 tests pasando
- ✅ Cobertura funcional configurada
- ✅ Setup de crypto polyfill funcionando

### **Cobertura Actual**

- **Statements**: 14.73% (42/285)
- **Branches**: 16.12% (5/31)
- **Functions**: 18.86% (10/53)
- **Lines**: 15.62% (40/256)

### **Threshold Configurado**

- Mínimo 50% en todas las métricas
- Configurable en `package.json`

## 🔗 **Archivos de Configuración Principales**

- ✅ `.vscode/tasks.json` - Tareas de VS Code
- ✅ `.vscode/launch.json` - Configuraciones de debug
- ✅ `.vscode/settings.json` - Configuraciones del workspace
- ✅ `.vscode/extensions.json` - Extensiones recomendadas
- ✅ `test/setup.ts` - Setup global de tests
- ✅ `package.json` - Configuración de Jest y scripts

## 💡 **Tips de Uso**

### **Debugging Eficiente**

- Usar conditional breakpoints para casos específicos
- Aprovechar el debug console para evaluar expresiones
- Watch variables importantes durante debug sessions

### **Testing Productivo**

- Usar "Run Tests in Watch Mode" durante desarrollo
- Revisar coverage reports regularmente
- Debuggear tests fallidos para entender problemas

### **Docker Integration**

- Usar "Attach to Running API" para debug en container
- Verificar que puertos de debug estén expuestos
- Coordinar con docker-compose para development

## 🎯 **Próximos Pasos Sugeridos**

1. **Expandir Tests**: Agregar tests para otros handlers y servicios
2. **E2E Tests**: Implementar tests end-to-end completos
3. **CI/CD**: Integrar tasks con pipelines de CI/CD
4. **Performance**: Agregar profiling y performance debugging
5. **Security**: Configurar security scanning en tasks

---

**¡Configuración completa y lista para desarrollo productivo!** 🎉
