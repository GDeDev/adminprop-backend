# 🔗 **Manejo Robusto de Correlation ID - Casos de Uso**

## 🎯 **Estrategia de Fallback Implementada**

El `EnhancedLoggerInterceptor` ahora maneja múltiples escenarios para obtener un correlation ID:

### **📋 Orden de Prioridad:**

1. **🥇 `x-correlation-id`** - Header principal (múltiples variaciones de case)
2. **🥈 `x-request-id`** - Común en load balancers (NGINX, HAProxy)
3. **🥉 `x-trace-id`** - AWS ALB, CloudFront, servicios de tracing
4. **🆕 `Generated UUID`** - Fallback cuando no existe ninguno

## 🧪 **Casos de Prueba**

### **✅ Caso 1: Cliente envía correlation ID**

```bash
curl -H "x-correlation-id: my-custom-123" http://localhost:3000/api/v1/examples
```

**Resultado**: Usa `my-custom-123`

### **✅ Caso 2: Load balancer añade request ID**

```bash
curl -H "x-request-id: nginx-456" http://localhost:3000/api/v1/examples
```

**Resultado**: Usa `nginx-456`

### **✅ Caso 3: AWS ALB añade trace ID**

```bash
curl -H "x-amzn-trace-id: Root=1-61e7b6c4-5e82012345678901" http://localhost:3000/api/v1/examples
```

**Resultado**: Usa `Root=1-61e7b6c4-5e82012345678901`

### **✅ Caso 4: Sin headers (más común)**

```bash
curl http://localhost:3000/api/v1/examples
```

**Resultado**: Genera UUID automáticamente `f47ac10b-58cc-4372-a567-0e02b2c3d479`

### **✅ Caso 5: Headers en diferentes cases**

```bash
curl -H "X-CORRELATION-ID: UPPER-CASE-123" http://localhost:3000/api/v1/examples
```

**Resultado**: Usa `UPPER-CASE-123`

## 📊 **Logs de Debug Generados**

### **Cuando encuentra correlation ID existente:**

```json
{
  "timestamp": "2025-06-27T10:30:45.123Z",
  "level": "DEBUG",
  "message": "Using existing correlation ID from x-correlation-id header",
  "context": "ApiLogger",
  "metadata": {
    "correlationId": "my-custom-123",
    "source": "header_correlation_id"
  }
}
```

### **Cuando usa fallback a request ID:**

```json
{
  "timestamp": "2025-06-27T10:30:45.123Z",
  "level": "DEBUG",
  "message": "Using x-request-id as correlation ID",
  "context": "ApiLogger",
  "metadata": {
    "correlationId": "nginx-456",
    "source": "header_request_id"
  }
}
```

### **Cuando genera nuevo UUID:**

```json
{
  "timestamp": "2025-06-27T10:30:45.123Z",
  "level": "DEBUG",
  "message": "Generated new correlation ID",
  "context": "ApiLogger",
  "metadata": {
    "correlationId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "source": "generated",
    "reason": "no_existing_headers_found"
  }
}
```

## 🌐 **Integración con Infraestructura**

### **✅ NGINX (Load Balancer)**

```nginx
# nginx.conf
location /api {
    proxy_set_header X-Request-ID $request_id;
    proxy_pass http://backend;
}
```

### **✅ AWS Application Load Balancer**

```yaml
# Los ALB automáticamente añaden:
# x-amzn-trace-id: Root=1-61e7b6c4-5e82012345678901
# El interceptor los detecta automáticamente
```

### **✅ Frontend Applications**

```typescript
// React/Angular/Vue - genera correlation ID
import { v4 as uuidv4 } from 'uuid'

const correlationId = uuidv4()

fetch('/api/v1/examples', {
  headers: {
    'x-correlation-id': correlationId,
    'content-type': 'application/json',
  },
})
```

### **✅ Microservices Propagation**

```typescript
// Al llamar otro servicio, propagar el correlation ID
const correlationId = request.headers['x-correlation-id']

await httpClient.post('http://other-service/api/users', {
  headers: {
    'x-correlation-id': correlationId,
  },
})
```

## 🔍 **Beneficios de esta Implementación**

### **1. 🤝 Compatibilidad Universal**

- ✅ **Frontend frameworks** (x-correlation-id)
- ✅ **Load balancers** (x-request-id)
- ✅ **AWS infrastructure** (x-amzn-trace-id)
- ✅ **Kubernetes ingress** (x-trace-id)

### **2. 🛡️ Robustez**

- ✅ **Case-insensitive** header matching
- ✅ **Whitespace trimming** automático
- ✅ **Multiple fallbacks** en orden de prioridad
- ✅ **Always generates** un ID válido

### **3. 🔍 Observabilidad**

- ✅ **Debug logs** muestran la fuente del ID
- ✅ **Tracking completo** del origen del correlation ID
- ✅ **Métricas** sobre qué fuentes se usan más

### **4. 📈 Performance**

- ✅ **Early return** en cuanto encuentra un ID válido
- ✅ **Minimal overhead** al procesar headers
- ✅ **UUID generation** solo cuando es necesario

## 🧪 **Pruebas Recomendadas**

### **Test en desarrollo:**

```bash
# Test sin headers
curl -v http://localhost:3000/api/v1/examples

# Test con correlation ID personalizado
curl -v -H "x-correlation-id: test-123" http://localhost:3000/api/v1/examples

# Test con diferentes cases
curl -v -H "X-CORRELATION-ID: TEST-456" http://localhost:3000/api/v1/examples

# Test con request ID de load balancer
curl -v -H "x-request-id: lb-789" http://localhost:3000/api/v1/examples
```

### **Verificar en logs:**

```bash
# Buscar correlation IDs generados
grep "Generated new correlation ID" logs/app.log

# Buscar correlation IDs existentes
grep "Using existing correlation ID" logs/app.log

# Buscar uso de fallbacks
grep "Using x-request-id as correlation ID" logs/app.log
```

## 🎯 **Casos de Edge Cubiertos**

- ✅ **Headers vacíos** o con solo espacios
- ✅ **Multiple headers** con el mismo nombre
- ✅ **Case variations** (upper, lower, mixed)
- ✅ **AWS-specific headers** (x-amzn-trace-id)
- ✅ **Load balancer headers** (x-request-id)
- ✅ **No headers** presentes (genera UUID)

---

**💡 Tip**: En producción, configura `LOG_LEVEL=info` o `warn` para evitar demasiados logs de debug del correlation ID.
