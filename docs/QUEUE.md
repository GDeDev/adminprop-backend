# Cola de trabajos (`QueuePort`)

Spec Fase 1, secciones 5.1 y 5.2. Hoy la implementa **pg-boss** sobre el mismo
Postgres (schema `pgboss`, que crea y migra pg-boss solo); mañana, SQS. Nadie
fuera de `src/platform/queue/adapters/` importa pg-boss.

## Uso

```ts
import { QueuePort, QueueDefinition } from '@/platform/queue/queue.port'

export const REMINDERS_QUEUE: QueueDefinition = {
  name: 'payment-reminders',
  retryLimit: 3, //         reintentos después del primer intento
  retryDelaySeconds: 30,
  retryBackoff: true, //    30s, 60s, 120s
}

// Publicar (desde un handler, dentro de un request)
await this.queue.publish(REMINDERS_QUEUE, { contractId })

// Consumir (en el onModuleInit del módulo que procesa)
await this.queue.consume<{ contractId: string }>(
  REMINDERS_QUEUE,
  async (message) => {
    // Ya estamos dentro del tenant del mensaje: los repositorios filtran solos.
    await this.reminders.send(message.payload.contractId)
  },
)
```

## Qué garantiza

- **Contexto**: al publicar se guardan el `tenantId`, el `userId` y el
  `correlationId` del request; el consumidor corre con ese contexto restaurado
  (`RequestContext.runInTenant`). Un worker no puede leer datos de otro tenant
  por olvidarse de filtrar.
- **Reintentos**: si el handler tira, el trabajo se reintenta `retryLimit`
  veces. Los handlers tienen que ser **idempotentes**: un reintento puede
  repetir trabajo ya hecho a medias.
- **Dead-letter**: agotados los reintentos, el mensaje pasa a
  `<cola>__dead_letter` (`deadLetterOf(name)`), donde queda para revisarlo o
  reprocesarlo.
- **Duplicados**: `publish(..., { singletonKey })` no encola un segundo trabajo
  con la misma clave mientras el primero siga vivo (tira `DuplicateJobError`).
- **Persistencia**: un reinicio del proceso no pierde trabajos. Con varias
  instancias, cada trabajo lo toma una sola.

## Proveedores

`QUEUE_PROVIDER=pgboss` (default) o `memory`. El de memoria es sólo para tests
unitarios: respeta contexto, reintentos y dead-letter, pero no persiste nada.

## Por qué pg-boss 10 y no 12

pg-boss 11+ se publica sólo como ESM. El proyecto compila a CommonJS y Jest
corre en modo CommonJS, que no puede cargar paquetes ESM sin transpilarlos.
La rama 10 sigue mantenida (`maint-v10`) y tiene la misma API de colas,
reintentos y dead-letter. Pasar a la 12 va junto con mover el proyecto a ESM.
Ver `docs/DECISIONES_TECNICAS.md`.
