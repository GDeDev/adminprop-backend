# Acciones pesadas en background (`AsyncJob`)

Spec Fase 1, sección 9.1. Cualquier acción que el usuario dispara y que procesa
muchos registros o llama muchas veces a un servicio externo (reenviar
recordatorios a todos los morosos, regenerar los PDFs del mes) **nunca corre
dentro del request**.

```
POST /algo/masivo  →  crea AsyncJob (PENDING) + encola en pg-boss  →  202 { jobId }
worker             →  PROCESSING → recordItem() por ítem → complete()
front              →  GET /api/v1/jobs/:id/status  (hasta que status sea final)
```

## Del lado del módulo que encola

`JobsModule` y `AsyncJobsFacade` se importan desde `@/modules/jobs/public`.

```ts
const jobId = await this.jobs.start('regenerate-pdfs', {
  totalItems: ids.length,
})
await this.queue.publish(REGENERATE_QUEUE, { jobId, ids })
return { jobId } // con @HttpCode(202)

// En el consumidor (ya dentro del tenant del mensaje):
await this.jobs.markProcessing(jobId)
for (const id of ids) {
  try {
    await this.regenerate(id)
    await this.jobs.recordItem(jobId, 'succeeded')
  } catch {
    await this.jobs.recordItem(jobId, 'failed')
  }
}
await this.jobs.complete(jobId, {/* detalle libre */})
```

- `complete()` elige el estado final según los contadores: `COMPLETED`,
  `COMPLETED_WITH_ERRORS` o `FAILED`. Es idempotente: un reintento de la cola
  no reabre un trabajo cerrado.
- `fail(jobId, reason)` cierra como `FAILED` un trabajo que no pudo seguir.
- `recordItem` hace un `increment` atómico: varios workers pueden reportar a la
  vez.

## `GET /api/v1/jobs/:id/status`

Endpoint único para toda la app. Sólo para `ADMIN` y `EMPLOYEE`: propietarios e
inquilinos comparten tenant con la inmobiliaria y el `result` de un trabajo
puede tener datos de otros. Un job de otra inmobiliaria da **404**.

```json
{
  "success": true,
  "message": null,
  "data": {
    "id": "…",
    "type": "regenerate-pdfs",
    "status": "PROCESSING",
    "totalItems": 120,
    "processedItems": 45,
    "failedItems": 2,
    "progress": 37,
    "result": null,
    "startedAt": "2026-09-19T12:00:00.000Z",
    "finishedAt": null
  }
}
```

`progress` es `null` si no se conoce el total, y 100 en cualquier estado final.
