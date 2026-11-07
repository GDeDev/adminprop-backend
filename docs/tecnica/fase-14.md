# Fase 14 — Notificaciones y mailing (backend)

Sale de `adminprop-repo-files/docs/REDISENO_FASE_14.md` (manda sobre la spec) y de `shared-types/notifications.ts` del frontend (el contrato HTTP, que el backoffice ya consume). Rama `feature/fase-14-notificaciones`, **encadenada sobre `feature/fase-22-portal-publico`**. Hecha **sin supervisión**. Decisiones D-141 a D-156 y supuestos A-111 a A-124 en [`../DECISIONES_TECNICAS.md`](../DECISIONES_TECNICAS.md) (el rediseño llamaba A-50 a A-59 a los diez primeros; mapa abajo).

## Qué quedó construido

**Migraciones** (`add_notifications_delivery`, `add_external_notification_recipient`, `add_notification_audit_columns`)

- `notification_log` suma `template_key`, `subject`, `attempts`, `next_attempt_at`, `provider_message_id` (índice) y `skip_reason`, más un índice `(tenant_id, status, created_at)`. El enum `NotificationRecipientKind` suma `EXTERNAL` (el contrato lo tiene).
- Tablas nuevas, todas con `tenant_id`: `notification_templates`, `notification_settings`, `notification_user_preferences`, `email_events` (único `(provider_message_id, event_type)`) y `whatsapp_templates`. Declaradas en `auditable-models.ts`: plantillas, configuración y WhatsApp **con auditoría**; preferencias personales y eventos del proveedor sin ella.

**Puertos de `platform`**

- `EmailPort.send` devuelve `{ providerMessageId? }` y puede tirar `EmailDeliveryError { retryable, code }`; `EmailMessage` suma `attachments`, `fromName` y ya tenía `replyTo`. Adapters: `ConsoleEmailAdapter` (devuelve un id `console_<uuid>`), `ResendEmailAdapter` (HTTP con `fetch`, sin SDK; 429, 5xx y cortes de red son temporales, el resto de los 4xx definitivos) y `FlakyEmailAdapter` (doble de pruebas: falla N veces).
- `svix-signature.ts`: firma y verificación Svix (HMAC-SHA256 sobre `id.timestamp.cuerpo`, tolerancia de 5 minutos, varias firmas por header, comparación en tiempo constante).
- `StoragePort.download(key, url)` (disco: lee el archivo; Cloudinary: lo baja por la URL).
- `NotificationsService` conserva `send()` y `notifyStaff()` con la misma firma, pero ahora delega en un `NotificationsPipeline` (clase abstracta de `platform`) que implementa el módulo `notifications`. `platform` no puede importar módulos; el puerto invierte la dependencia.

**Módulo `src/modules/notifications`**

| Capa             | Piezas                                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `domain`         | `notification-catalog.ts` (los 19 tipos con audiencia, obligatorio, crítico, canales por defecto y disponibles), `notification-templates.ts` (variables, textos por defecto, render con escape, layout HTML), `whatsapp-templates.ts`, `delivery-policy.ts` (preferencias y backoff, puro), `notification.ports.ts`, `notification.exceptions.ts` |
| `application`    | `NotificationPipeline` (dedupe, preferencias, plantilla, cola), `NotificationDeliveryService` (intento, reintentos, fallo definitivo, adjuntos, auditoría), `TemplateService`, `ResendEventService` / `ResendWebhookService`, handlers CQRS de historial y de configuración                                                                       |
| `infrastructure` | repositorios Prisma, `NotificationsController`, `WebhooksController`, consumidores (`notification-delivery`, `notification-events`), `NotificationsModule` (`@Global`, sólo para proveer el `NotificationsPipeline`)                                                                                                                              |
| `public`         | `NotificationsModule` y `NotificationsFacade.inAppOptOutTypes` (la usa la campana)                                                                                                                                                                                                                                                                |

**Cambios en otros módulos (por sus `public/`)**: `UsersFacade.listStaffContacts()`, `DocumentsFacade.currentPdf()` (nueva), cola `payment-confirmed-notifications` en el relay de cobros, y en automatizaciones `ALERT_TYPES` + `NOTIFICATION_FAILED` y `EMAIL_BOUNCED` y el filtro de la campana por usuario.

## Flujo de un aviso

1. Un job o consumidor llama `NotificationsService.send(request)` (igual que en la Fase 13).
2. **Dedupe** por `dedupeKey`: una fila `QUEUED` o `SENT` nunca se repite. Una `FAILED` o `SKIPPED` se vuelve a evaluar (D-143).
3. **Decisión** (`decideDelivery`): tipo habilitado (un obligatorio siempre), canales pedidos dentro de los permitidos por la inmobiliaria, preferencia personal (sólo personal, sólo no obligatorios), y datos de contacto del canal principal. Si no sale: fila `SKIPPED` con `skip_reason`.
4. **Render**: override de la inmobiliaria o texto por defecto, con las variables normalizadas desde el `data` del job; los montos se formatean por texto.
5. Fila `QUEUED` y mensaje en la cola `notifications-deliver`. Un aviso interno (`IN_APP`) o de WhatsApp queda `SENT` en el momento (no hay nada que entregar).
6. **Entrega**: `EmailPort.send`. Éxito: `SENT` con `provider_message_id` y auditoría `NOTIFICATION_SENT` (actor sistema). Error temporal: `QUEUED` con `attempts`, `next_attempt_at` y `error`, y un mensaje nuevo con `startAfterSeconds` de **60, 300 y 1800** segundos (cuatro intentos en total). Agotados, o error definitivo: `FAILED`; si el tipo es crítico (`INSURER_ALERT`, `ARREARS_NOTICE`, `SETTLEMENT_CONFIRMED`, `OWNER_STATEMENT_CLOSED`) se crea el aviso interno `NOTIFICATION_FAILED`.
7. **Webhook** `POST /webhooks/resend`: verifica la firma sobre el cuerpo crudo, busca el mensaje por `provider_message_id` entre todas las inmobiliarias, entra a su tenant e inserta el evento (un repetido no duplica). Un rebote o una queja crean `EMAIL_BOUNCED` (una vez por mensaje).

El personal recibe **un mail por persona** (`dedupeKey` + `:u:<usuario>`) y **un solo aviso interno** compartido por la campana.

## Eventos que disparan avisos nuevos

`SettlementsModule` ya publicaba `settlement-confirmed` y `statement-closed` sin consumidor; ahora los consume `NotificationEventsConsumer` (`SETTLEMENT_CONFIRMED`, `OWNER_STATEMENT_CLOSED`, ambos con el PDF adjunto). El pago confirmado tiene cola propia (`payment-confirmed-notifications`, porque pg-boss entrega cada mensaje a un solo consumidor) y alimenta `PAYMENT_RECEIVED`, apagado por defecto.

## Endpoints (todos en `{ success, message, data }`; admin salvo indicación)

`GET /notifications`, `GET /notifications/:id`, `POST /notifications/:id/resend`, `POST /notifications/resend-failed` (202, AsyncJob `notifications-resend-failed`; `GET /jobs/:id/status` es genérico y ya lo soporta), `GET|PUT /notifications/settings`, `GET /notifications/templates`, `PUT|DELETE /notifications/templates/:key`, `POST /notifications/templates/:key/preview` y `/test`, `GET|PUT /notifications/me/preferences` (**admin y empleado**), `GET /notifications/whatsapp-templates` (**admin y empleado**), `PUT /notifications/whatsapp-templates/:key`, `POST /notifications/dev/events` (sólo `EMAIL_PROVIDER=console` fuera de producción; si no, 404) y `POST /webhooks/resend` (público, firma Svix; 401 si es inválida o si no hay `RESEND_WEBHOOK_SECRET`).

Errores: 404 `NOTIFICATION_NOT_FOUND` (también de otra inmobiliaria), `TEMPLATE_NOT_FOUND`, `NOTIFICATION_TYPE_UNKNOWN`; 409 `NOTIFICATION_NOT_RESENDABLE`; 422 `NOTIFICATION_MANDATORY`, `NOTIFICATION_CHANNEL_NOT_AVAILABLE`, `TEMPLATE_UNKNOWN_VARIABLE`, `TEMPLATE_TEST_NO_EMAIL`.

## Variables de entorno (Doppler; todas opcionales con `console`)

`EMAIL_PROVIDER` (`console` por defecto | `resend`), `EMAIL_FROM`, `RESEND_API_KEY` (las dos son obligatorias sólo con `resend`), `RESEND_WEBHOOK_SECRET` (`whsec_...`), `PORTAL_BASE_URL` (para `{{portalUrl}}` = `<base>/<slug>`). Sin cuenta de Resend todo corre con el adapter de consola.

## Desvíos respecto de `notifications.ts`

Ninguno en la forma de las respuestas. `NotificationLogItem.channel` es el primer canal efectivo de la fila; `recipientLabel` sale del nombre que trae el aviso (o del email, o "Personal de la inmobiliaria"). Las filas `IN_APP` del personal no figuran en `GET /notifications` (están en `/automations/alerts`).

## Tests

- Unitarios: catálogo y plantillas (cada default sólo usa variables declaradas; escape de HTML; asunto de una línea), reglas de entrega (tipo apagado, canal sacado, opt-out, obligatorio, sin email/teléfono, backoff), variables, adapter de Resend (clasificación de errores), doble `Flaky`, firma Svix y `buildWhatsAppLink`.
- E2E `test/notifications.e2e-spec.ts` (37 casos): entrega y detalle, auditoría, dedupe, lote con un inquilino sin email, aislamiento entre inmobiliarias (historial, detalle, reenvío, configuración, plantillas, WhatsApp, trabajo), filtros y permisos, configuración y obligatorios, opt-out por usuario y campana, reintentos con espera, agotamiento crítico con aviso, no crítico sin aviso, error definitivo, reenvío manual, "reintentar fallidas" como AsyncJob, adjunto del PDF, espera sin PDF, plantillas (editar, restaurar, vista previa, prueba), webhook (entrega/apertura, duplicado, rebote, firma inválida, cuerpo alterado, timestamp vencido, mensaje desconocido) y evento simulado. `test/automations.e2e-spec.ts` ahora lee los avisos desde `notification_log`.

## Mapa de supuestos

| Rediseño | Backend |     | Rediseño | Backend |
| -------- | ------- | --- | -------- | ------- |
| A-50     | A-111   |     | A-55     | A-116   |
| A-51     | A-112   |     | A-56     | A-117   |
| A-52     | A-113   |     | A-57     | A-118   |
| A-53     | A-114   |     | A-58     | A-119   |
| A-54     | A-115   |     | A-59     | A-120   |
