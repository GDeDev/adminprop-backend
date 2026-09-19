# Feature flags (`FeatureFlagPort`)

Spec Fase 1, sección 5.3. Prender o apagar funcionalidad sin deploy, y probarla
primero con una inmobiliaria antes de habilitarla al resto.

```ts
if (await this.flags.isEnabled('automatic-appraisal')) {
  // ...
}
```

- Se consulta desde un **Handler o Controller, nunca desde un Domain Service**:
  el flag decide si se invoca una regla, no cómo se comporta.
- Sin `context`, se evalúa para el tenant del request en curso.
- **Falla cerrado**: si el proveedor no responde o el flag no existe, devuelve
  `false`. Una funcionalidad nueva se apaga antes que romper el request.

## Segmentar por inmobiliaria en Flagsmith

Cada tenant es una _identity_ `tenant_<tenantId>` con el trait `tenant_id`.
Para prender un flag sólo para una inmobiliaria:

1. Flagsmith → Segments → nuevo segmento con la regla `tenant_id = <id>`.
2. En el flag → Segment overrides → ese segmento, prendido.

No hace falta código propio para esto.

## Proveedores (`FEATURE_FLAGS_PROVIDER`)

| Valor       | Cuándo                                                                                      |
| ----------- | ------------------------------------------------------------------------------------------- |
| `flagsmith` | Default si existe `FLAGSMITH_ENVIRONMENT_KEY` (en Doppler, dev_backend)                     |
| `memory`    | Default sin key: tests y desarrollo sin cuenta. `FEATURE_FLAGS_ENABLED` lista los prendidos |

Mañana, AWS AppConfig: un `AppConfigFeatureFlagAdapter` y un `case` en
`feature-flags.module.ts`.

# Email (`EmailPort`)

`EmailPort.send({ to, subject, text, html? })`. Hoy el único adapter es
`console` (loguea destinatario y asunto; el cuerpo sólo en debug). El proveedor
real, Resend vía Novu, llega con las notificaciones en la Fase 14: quien ya
dependa del puerto no cambia.
