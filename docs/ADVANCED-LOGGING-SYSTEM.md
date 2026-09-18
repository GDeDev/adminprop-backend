# 📝 **Sistema de Logging Avanzado - NestJS**

## 🎯 **Descripción General**

Este sistema de logging implementa las mejores prácticas para aplicaciones NestJS empresariales, proporcionando logging estructurado, correlation IDs robustos, y observabilidad completa sin dependencias externas.

## ✨ **Características Principales**

### 🏗️ **Logging Estructurado**

- **Formato JSON** en producción para herramientas de monitoring
- **Formato legible** en desarrollo con colores y emojis
- **Metadata contextual** rica en cada log
- **Niveles configurables** por entorno

### 🔗 **Correlation ID Robusto**

- **Múltiples fuentes** de correlation ID con fallbacks inteligentes
- **Compatibilidad universal** con AWS, NGINX, Kubernetes
- **Tracking automático** entre requests relacionados
- **Case-insensitive** header detection

### ⚡ **Métodos Especializados**

- `logApiCall()` - Para endpoints REST con métricas automáticas
- `logCommandExecution()` - Para CQRS Commands con timing
- `logQueryExecution()` - Para CQRS Queries con conteos
- `logBusinessOperation()` - Para operaciones de negocio críticas

## 🚀 **Instalación y Configuración**

### **1. Instalar Dependencias**

```bash
npm install uuid
npm install --save-dev @types/uuid
```

### **2. Configurar Variables de Entorno**

#### **`.env` (Development)**

```bash
LOG_LEVEL=debug
NODE_ENV=development
```

#### **`.env.qa` (QA)**

```bash
LOG_LEVEL=info
NODE_ENV=qa
```

#### **`.env.production` (Production)**

```bash
LOG_LEVEL=warn
NODE_ENV=production
```

### **3. Integrar en SharedModule**

```typescript
// src/shared/shared.module.ts
import { LoggerModule } from './core/logger.module'

@Module({
  imports: [
    LoggerModule, // ← Agregar aquí
    // ... otros imports
  ],
  exports: [
    LoggerModule, // ← Exportar aquí
    // ... otros exports
  ],
})
export class SharedModule {}
```

### **4. Actualizar main.ts**

```typescript
// src/main.ts
import { EnhancedLoggerInterceptor } from './shared/infra/interceptors/enhanced-logger.interceptor'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)

  // Reemplazar interceptor existente
  app.useGlobalInterceptors(new EnhancedLoggerInterceptor())

  // ... resto de configuración
}
```

## 🔧 **Uso en Handlers**

### **Command Handler Mejorado**

```typescript
import { CustomLoggerService } from '@/shared/core/logger.service'

@CommandHandler(CreateExampleCommand)
export class CreateExampleHandler {
  private readonly logger = new CustomLoggerService(CreateExampleHandler.name)

  async execute(command: CreateExampleCommand): Promise<CreateExampleResult> {
    const startTime = Date.now()

    this.logger.log('Executing CreateExampleCommand', {
      operation: 'command_start',
      commandName: 'CreateExampleCommand',
      inputData: command.data,
    })

    try {
      const validation = this.validate(command)
      if (validation.isFailure) {
        this.logger.warn('Command validation failed', {
          operation: 'validation_failed',
          commandName: 'CreateExampleCommand',
          validationError: validation.getErrorValue(),
        })
        return Result.fail(validation.getErrorValue())
      }

      const example = new Example(command.data.name)
      await this.exampleRepository.create(example)
      const duration = Date.now() - startTime

      this.logger.logCommandExecution('CreateExampleCommand', duration, true, {
        entityType: 'Example',
        entityName: command.data.name,
      })

      this.logger.logBusinessOperation('example_created', example.id, userId, {
        exampleName: command.data.name,
        createdAt: new Date().toISOString(),
      })

      return Result.ok({ id: example.id })
    } catch (error) {
      const duration = Date.now() - startTime

      this.logger.logCommandExecution('CreateExampleCommand', duration, false, {
        errorName: error.name,
        errorMessage: error.message,
        inputData: command.data,
      })

      return Result.fail(error.message)
    }
  }
}
```

### **Query Handler Mejorado**

```typescript
@QueryHandler(GetExamplesQuery)
export class GetExamplesHandler {
  private readonly logger = new CustomLoggerService(GetExamplesHandler.name)

  async execute(query: GetExamplesQuery): Promise<GetExamplesResponse> {
    const startTime = Date.now()

    this.logger.log('Starting GetExamplesQuery execution', {
      operation: 'query_start',
      queryName: 'GetExamplesQuery',
    })

    try {
      const examples = await this.exampleRepository.findAll()
      const duration = Date.now() - startTime

      this.logger.logQueryExecution(
        'GetExamplesQuery',
        duration,
        examples.length,
        {
          resultCount: examples.length,
          paginationTotal: examples.length,
        },
      )

      return { data: examples, pagination }
    } catch (error) {
      const duration = Date.now() - startTime

      this.logger.error('GetExamplesQuery execution failed', error.stack, {
        operation: 'query_error',
        queryName: 'GetExamplesQuery',
        duration,
        errorName: error.name,
        errorMessage: error.message,
      })

      throw error
    }
  }
}
```

## 🔗 **Manejo de Correlation ID**

### **Estrategia de Fallback**

El sistema busca correlation IDs en el siguiente orden de prioridad:

1. **🥇 `x-correlation-id`** - Header principal (case-insensitive)
2. **🥈 `x-request-id`** - Común en load balancers (NGINX, HAProxy)
3. **🥉 `x-trace-id`** - AWS ALB, CloudFront, sistemas de tracing
4. **🆕 `Generated UUID`** - Fallback automático cuando no existe ninguno

### **Casos de Uso Cubiertos**

```bash
# Cliente envía correlation ID
curl -H "x-correlation-id: my-custom-123" http://localhost:3000/api/v1/examples

# Load balancer añade request ID
curl -H "x-request-id: nginx-456" http://localhost:3000/api/v1/examples

# AWS ALB añade trace ID
curl -H "x-amzn-trace-id: Root=1-61e7b6c4-5e82012345678901" http://localhost:3000/api/v1/examples

# Sin headers (genera UUID automáticamente)
curl http://localhost:3000/api/v1/examples
```

## 📊 **Formatos de Output**

### **Development Mode (Legible)**

```
🔵 [2025-06-27T10:30:45.123Z] [INFO] [CreateExampleHandler] [abc-123] Executing CreateExampleCommand
  📋 Metadata: {
    "operation": "command_start",
    "commandName": "CreateExampleCommand",
    "inputData": { "name": "Test Example" }
  }

🔵 [2025-06-27T10:30:45.200Z] [INFO] [CreateExampleHandler] [abc-123] Command completed in 77ms
  📋 Metadata: {
    "operation": "command_execution",
    "duration": 77,
    "success": true,
    "entityType": "Example"
  }
```

### **Production Mode (JSON Estructurado)**

```json
{
  "timestamp": "2025-06-27T10:30:45.123Z",
  "level": "INFO",
  "message": "Executing CreateExampleCommand",
  "context": "CreateExampleHandler",
  "correlationId": "abc-123",
  "metadata": {
    "operation": "command_start",
    "commandName": "CreateExampleCommand"
  }
}
```

## 🌐 **Integración con Infraestructura**

### **NGINX (Load Balancer)**

```nginx
location /api {
    proxy_set_header X-Request-ID $request_id;
    proxy_pass http://backend;
}
```

### **Frontend Applications**

```typescript
import { v4 as uuidv4 } from 'uuid'

const correlationId = uuidv4()

fetch('/api/v1/examples', {
  headers: {
    'x-correlation-id': correlationId,
    'content-type': 'application/json',
  },
})
```

### **Microservices Propagation**

```typescript
// Al llamar otro servicio, propagar el correlation ID
const correlationId = request.headers['x-correlation-id']

await httpClient.post('http://other-service/api/users', {
  headers: {
    'x-correlation-id': correlationId,
  },
})
```

## 🎯 **Patrones de Uso Recomendados**

### **✅ Logs de Inicio/Fin de Operación**

```typescript
// Inicio
this.logger.log('Starting operation', {
  operation: 'operation_start',
  operationName: 'ProcessPayment',
  inputData: sanitizedInput,
})

// Fin exitoso
this.logger.log('Operation completed successfully', {
  operation: 'operation_success',
  operationName: 'ProcessPayment',
  duration,
  resultSummary: { processedAmount: 100 },
})
```

### **✅ Logs de Validación**

```typescript
if (validation.isFailure) {
  this.logger.warn('Validation failed', {
    operation: 'validation_failed',
    validationErrors: validation.getErrorValue(),
    inputData: sanitizedInput,
  })
  return Result.fail(validation.getErrorValue())
}
```

### **✅ Logs de Error con Contexto**

```typescript
catch (error) {
  this.logger.error('Database operation failed', error.stack, {
    operation: 'database_error',
    query: 'findUserById',
    userId,
    tableName: 'users',
    errorCode: error.code,
  })
  throw error
}
```

## 🧪 **Testing y Debugging**

### **Buscar Logs por Correlation ID**

```bash
# Buscar todos los logs de un request específico
grep "abc-123-def" application.log

# En desarrollo - usar header personalizado
curl -H "x-correlation-id: debug-123" http://localhost:3000/api/v1/examples
```

### **Configurar Debug Levels**

```bash
# Ver solo errores y warnings en producción
LOG_LEVEL=warn npm run start:prod

# Ver información detallada en desarrollo
LOG_LEVEL=debug npm run start:dev

# Nivel balanceado para QA
LOG_LEVEL=info npm run start:qa
```

## 📈 **Beneficios del Sistema**

### **🔍 Para Desarrollo**

- **Logs colorados** y fáciles de leer
- **Contexto completo** en cada mensaje
- **Debugging simplificado** con correlation IDs
- **Metadata estructurada** para análisis

### **🏭 Para Producción**

- **JSON estructurado** para herramientas de monitoring
- **Filtrado automático** por niveles
- **Trazabilidad completa** de requests
- **Performance metrics** integradas

### **⚙️ Para Operaciones**

- **Métricas automáticas** de duración y conteos
- **Correlación de errores** entre componentes
- **Búsqueda eficiente** por correlation ID
- **Alertas basadas** en patrones de logs

## 🔧 **Solución de Problemas**

### **✅ Build Corregido**

El proyecto ahora compila correctamente con todos los errores resueltos:

- ✅ **ESLint formatting errors** - Líneas muy largas corregidas
- ✅ **Unused variable warnings** - Variables renombradas con prefijo `_`
- ✅ **Import case sensitivity** - Imports consistentes con nombres de archivo
- ✅ **TypeScript compliance** - Tipos correctos en toda la aplicación
- ✅ **Package.json scripts** - Rutas corregidas para `dist/src/main`

### **📁 Archivos del Sistema**

```
src/
├── shared/
│   ├── core/
│   │   ├── logger.service.ts       # Servicio principal de logging
│   │   └── logger.module.ts        # Módulo para dependency injection
│   └── infra/
│       └── interceptors/
│           └── enhanced-logger.interceptor.ts  # Interceptor HTTP mejorado
├── application/
│   └── feature/
│       ├── commands/
│       │   └── create-example/
│       │       └── create-example.handler.ts   # Handler con logging mejorado
│       └── queries/
│           └── get-examples/
│               └── get-examples.handler.ts     # Handler con logging mejorado
```

### **🚀 Scripts NPM Corregidos**

```json
{
  "start:prod": "node dist/src/main",
  "start:qa": "NODE_ENV=qa node dist/src/main",
  "start:production": "NODE_ENV=production node dist/src/main"
}
```

## 📋 **Checklist de Implementación**

- [ ] ✅ Instalar dependencias (`uuid`, `@types/uuid`)
- [ ] ✅ Configurar variables de entorno (`LOG_LEVEL`)
- [ ] ✅ Agregar `LoggerModule` al `SharedModule`
- [ ] ✅ Reemplazar interceptor en `main.ts`
- [ ] ✅ Actualizar handlers existentes con nuevo logger
- [ ] ✅ Verificar build con `npm run build`
- [ ] ✅ Probar en desarrollo con `npm run start:dev`
- [ ] ✅ Validar logs en producción con `npm run start:prod`

## 🎯 **Próximos Pasos Opcionales**

1. **Integrar con herramientas de monitoring** (ELK, Datadog, New Relic)
2. **Configurar alertas** basadas en logs de error
3. **Implementar métricas** personalizadas de negocio
4. **Añadir dashboards** para visualización de logs
5. **Configurar log rotation** para archivos en disco

---

**🎉 Sistema de logging completamente funcional, probado y listo para producción!**
