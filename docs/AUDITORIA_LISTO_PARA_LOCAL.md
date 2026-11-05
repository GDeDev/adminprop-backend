# Auditoría: ¿está listo para levantar todo en local?

Rama del backend: `integration/consolidado-3`. Rama del frontend:
`integration/frontend-5` (leída y levantada desde una copia, sin tocar su
checkout). Fecha de la corrida: 2026-11-05 (00:20 a 00:35 UTC, es decir 4 de
noviembre a la noche en Buenos Aires).

## Veredicto: listo con salvedades

La API arranca, migra, crea la inmobiliaria con su admin, y los flujos de plata
que se probaron (cuotas, punitorio, pago parcial, saldo a favor, rescisión,
devolución de depósito, liquidación) dan los números correctos hechos a mano.
El backoffice real (`next dev`) inicia sesión y muestra dashboard, propiedades,
contratos, cobros y parámetros contra esa API, sin mocks.

Las salvedades son de **configuración y documentación**, no de lógica:

1. Sin `CORS_ORIGINS` en `dev_backend` **ni el login del backoffice entra**.
2. Una variable de enum/`PORT`/TTL creada **vacía** en Doppler hace que la API
   no arranque (la regla "crear vacía" sirve solo para el resto).
3. `SITES_SERVER_SECRET` no debe crearse (rompe la exención de tope de
   `apps/sites`).
4. `npm run start:prod` y el Dockerfile apuntan a un archivo que no existe (no
   afecta el desarrollo con `start:dev`).
5. Quedó sin probar todo lo que depende de Doppler, Docker, Windows, portal,
   sitios y servicios externos (sección 7).

## 1. Qué se corrigió en la guía del backend

`docs/ARRANQUE_LOCAL_BACKEND.md`: mapeo real de Doppler (proyecto `admin-prop`:
`dev_backend`, `dev_backoffice`, `dev_portal`; sitios sin config confirmada,
sugerencia `dev_sites` vacía), reglas del dueño (nunca `.env` con valores reales;
variables nuevas vacías con `doppler secrets set NAME="" --project admin-prop
--config <cfg>`), aviso de que el CLI de Doppler en Windows puede no estar en el
`PATH`, la lista de variables que rompen con valor vacío, `CORS_ORIGINS` para los
frontends, `prisma generate` tras `npm ci`, localidades a crear antes de la
primera propiedad, `start:prod` roto y una sección nueva de puertos y orden de
arranque.

## 2. Coherencia entre las dos guías de arranque

| Tema                                                 | Backend                                                                                    | Frontend                                                                         | Estado                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Puertos                                              | API 3000 (`PORT`)                                                                          | backoffice 3001, portal 3002, sitios 3003 (scripts `dev`)                        | Coherente. El default de `SITES_DEV_URL` del backend (`localhost:3003`) y el de `NEXT_PUBLIC_SITES_URL` del frontend también coinciden.                                                                                                               |
| Orden                                                | Postgres, migraciones, tenant, API                                                         | "Backend primero", luego frontend                                                | Coherente.                                                                                                                                                                                                                                            |
| `NEXT_PUBLIC_API_URL`                                | La API escucha en `3000` y el prefijo es `/api/v1`                                         | `http://localhost:3000/api/v1`                                                   | Coherente. Probado: con ese valor el backoffice funciona.                                                                                                                                                                                             |
| `CORS_ORIGINS`                                       | "Sin definir, CORS cerrado"                                                                | "a confirmar qué valor trae `dev_backend`"                                       | **Resuelto aquí.** Debe ser `http://localhost:3001,http://localhost:3002` (con `localhost`, no `127.0.0.1`). Probado: sin él el login falla por CORS. El `.env.example` del backend trae `3000,5173` (del template), que no sirve para este frontend. |
| `SITES_REVALIDATE_SECRET`                            | Secreto del aviso de publicación (`Authorization: Bearer`)                                 | Mismo nombre; prende `POST /api/revalidate`                                      | Coherente (mismo header Bearer en las dos puntas, leído en el código). Debe tener el **mismo valor** en `dev_backend` y en la config de sitios.                                                                                                       |
| `SITES_SERVER_SECRET`                                | "Distinto del anterior", para `X-Sites-Secret`                                             | No existe en `apps/sites`: manda `SITES_REVALIDATE_SECRET` como `X-Sites-Secret` | **Incoherente.** Ver bug B1. La guía del frontend lo deja como "a confirmar"; queda confirmado.                                                                                                                                                       |
| `SITES_PREVIEW_SECRET`                               | Solo la usa la API (firma de vista previa y TXT de dominios); obligatoria en qa/producción | No la usa                                                                        | Coherente. En local la API usa un valor fijo de desarrollo.                                                                                                                                                                                           |
| `SITES_BASE_DOMAIN` / `SITES_PROTOCOL`               | Opcionales, vacías                                                                         | Opcionales                                                                       | Coherente. Si se prueban subdominios, el mismo valor en las dos configs.                                                                                                                                                                              |
| `SITES_CLIENT_IP_HEADER`, `SITES_TRUSTED_PROXY_HOPS` | No las lee                                                                                 | La guía dice que ninguna app las lee                                             | **La guía del frontend se equivoca**: las lee `apps/sites/src/lib/client-ip.ts` (IP del visitante para el tope de la API). Son opcionales; el default sirve en local.                                                                                 |

Qué pasa si falta cada variable (verificado en el código):

- Backend, `DATABASE_URL` o `JWT_*_SECRET` faltantes/cortos/iguales: la API no
  arranca y dice cuál. `CORS_ORIGINS` faltante: arranca, loguea "CORS
  deshabilitado" y el navegador bloquea todo (login incluido).
- Backend, `SITES_PREVIEW_SECRET` faltante: en development usa un valor fijo; con
  `NODE_ENV=qa|production` no arranca. `SITES_REVALIDATE_URL` o
  `SITES_REVALIDATE_SECRET` faltantes: no se avisa a sitios al publicar (queda el
  caché de hasta dos minutos). `APP_ENCRYPTION_KEY` faltante: arranca, falla al
  guardar un token de portal (CRM).
- Frontend, `NEXT_PUBLIC_API_URL` faltante: los route handlers de sesión
  responden `API_URL_MISSING`, el cliente HTTP no tiene `baseURL` y la CSP no
  permite la API. Se inyecta al compilar: después de cambiarla hay que reiniciar
  `next dev` (o rehacer el build).
- Portal, `PORTAL_TENANT_SLUG` faltante: el login avisa que no hay
  inmobiliaria configurada.
- Sitios, `API_URL` y `NEXT_PUBLIC_API_URL` faltantes: no puede pedir nada a la
  API. `SITES_REVALIDATE_SECRET` faltante: `/api/revalidate` responde 404 y no
  manda `X-Sites-Secret`.

## 3. Variables que el dueño debe crear o cargar en Doppler

Proyecto `admin-prop`. Para no dejar valores a la vista, listar nombres con
`doppler secrets --only-names --project admin-prop --config <cfg>` antes de crear
nada: si `dev_backend` ya tiene alguna, no se vuelve a crear. Las que tienen
valor fijo y no secreto se pueden cargar directo; las secretas se generan con
`openssl rand` (en Windows: Git Bash, o cualquier generador de 32 bytes en hex).

### `dev_backend`

| Variable                              | Obligatoria                          | Valor / de dónde sale                                                                                                    |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                        | Sí                                   | `postgresql://adminprop:adminprop@localhost:5432/adminprop_development` (usuario del `docker-compose`, solo desarrollo). |
| `JWT_ACCESS_SECRET`                   | Sí                                   | `openssl rand -base64 48` (32+ caracteres).                                                                              |
| `JWT_REFRESH_SECRET`                  | Sí                                   | Otro `openssl rand -base64 48`, distinto del anterior.                                                                   |
| `CORS_ORIGINS`                        | Sí, para usar el frontend            | `http://localhost:3001,http://localhost:3002`                                                                            |
| `SITES_REVALIDATE_URL`                | No (solo si se levanta `apps/sites`) | `http://localhost:3003`                                                                                                  |
| `SITES_REVALIDATE_SECRET`             | No (solo con sitios)                 | `openssl rand -hex 32`; el mismo valor en la config de sitios.                                                           |
| `SITES_PREVIEW_SECRET`                | No en local (sí en qa/producción)    | `openssl rand -hex 32`.                                                                                                  |
| `APP_ENCRYPTION_KEY`                  | No (solo CRM / tokens de portales)   | `openssl rand -hex 32`.                                                                                                  |
| `SITES_BASE_DOMAIN`, `SITES_PROTOCOL` | No                                   | Vacías o sin crear; solo para probar subdominios.                                                                        |

**No crear** (ni vacías): `SITES_SERVER_SECRET` (bug B1) y ninguna variable
`*_PROVIDER`, `TOKKO_SOURCE`, `PORT`, `NODE_ENV`, `JWT_*_TTL` salvo que tengan un
valor válido. Con los defaults, en local la API usa almacenamiento en disco
(`/files`), emails por consola, flags en memoria, Tokko de muestra, portales
simulados y tasación de muestra: no hace falta ninguna cuenta externa
(Cloudinary, Resend, Flagsmith, Tokko, Mercado Libre, Anthropic) para las pruebas.

### `dev_backoffice`

| Variable                                      | Obligatoria           | Valor                          |
| --------------------------------------------- | --------------------- | ------------------------------ |
| `NEXT_PUBLIC_API_URL`                         | Sí                    | `http://localhost:3000/api/v1` |
| `NEXT_PUBLIC_SITES_URL`                       | No (ya es el default) | `http://localhost:3003`        |
| `NEXT_PUBLIC_SITES_DNS_TARGET`, `APP_ORIGINS` | No en local           | Sin crear.                     |

### `dev_portal`

| Variable              | Obligatoria | Valor                                                    |
| --------------------- | ----------- | -------------------------------------------------------- |
| `NEXT_PUBLIC_API_URL` | Sí          | `http://localhost:3000/api/v1`                           |
| `PORTAL_TENANT_SLUG`  | Sí          | El slug usado en `tenant:create` (por ejemplo `oppido`). |

### `dev_sites` (a crear, vacía) — solo si se prueba "Mi sitio web"

| Variable                  | Obligatoria | Valor                                                                                   |
| ------------------------- | ----------- | --------------------------------------------------------------------------------------- |
| `API_URL`                 | Sí          | `http://localhost:3000/api/v1`                                                          |
| `SITES_REVALIDATE_SECRET` | No          | El mismo valor que en `dev_backend`. Prende `/api/revalidate` y manda `X-Sites-Secret`. |

## 4. Pasos exactos del dueño, en orden

1. Instalar Node 22, Git, Docker, Doppler CLI y `gh`. En Windows, abrir una
   terminal nueva y comprobar `doppler --version`; si no se reconoce, agregarlo
   al `PATH`. Además hace falta el binario `docker-compose` (con guion) o correr
   a mano `docker compose --profile dev up -d`.
2. `doppler login`. Clonar los tres repos uno al lado del otro
   (`adminprop-backend`, `adminprop-frontend`, `adminprop-repo-files`) y hacer
   checkout de `integration/consolidado-3` (backend) y `integration/frontend-5`
   (frontend).
3. En Doppler, cargar las variables de la sección 3 (las secretas con
   `openssl rand`, y `doppler secrets set NAME="" ...` para las que se crean
   vacías para completarlas a mano).
4. Backend:
   ```bash
   cd adminprop-backend
   doppler setup                  # admin-prop / dev_backend
   npm ci
   npm run prisma:generate
   npm run docker:dev
   npm run prisma:migrate         # si propone borrar los dos índices parciales, decir que no
   npm run tenant:create -- --name "Oppido Propiedades" --slug oppido --admin-email <tu email>
   ```
   Anotar la contraseña que muestra (una sola vez). `tenant:create` ya carga los
   maestros base; `master-data:seed` solo hace falta para inmobiliarias viejas.
5. `npm run start:dev` y comprobar `http://localhost:3000/health`.
6. Frontend, en `adminprop-frontend`: `npm ci`; `doppler setup` en
   `apps/backoffice` (`dev_backoffice`) y en `apps/portal` (`dev_portal`); luego
   `npx turbo run dev --filter=@adminprop/backoffice` (y `--filter=@adminprop/portal`
   si se prueba el portal). `apps/sites` aparte (`doppler run -- npm run dev` dentro
   de `apps/sites`) y solo si se prueba el sitio.
7. Abrir `http://localhost:3001/login` e ingresar con el admin del paso 4.
8. Antes de la primera propiedad, crear una localidad (Configuración, Maestros):
   el catálogo solo trae el país y dos provincias.
9. Después de crear un contrato, las cuotas **no aparecen solas**: usar "Generar
   cuotas" en Cobros (o esperar el proceso automático mensual).
10. Con el sistema andando, seguir `docs/PLAN_PRUEBAS_MANUALES.md` (de
    `adminprop-repo-files`).

## 5. Qué se probó y resultado real

Entorno: Postgres 16 local, base propia `audit_local`, variables exportadas en el
shell con valores descartables (sin Doppler, sin `.env`, sin Docker), API con
`npm run build && node dist/main.js` y backoffice con `next dev` en una copia del
checkout del frontend.

| Prueba                                                                                    | Resultado                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                           | OK, 0 errores de tipos (878 archivos).                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| `prisma migrate deploy` en base vacía                                                     | OK, todas las migraciones, hasta `20261107140000_rent_update_manual_justification`.                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `master-data:seed` en base sin inmobiliarias                                              | "No hay inmobiliarias" (esperado).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `tenant:create` con el cliente de Prisma desactualizado                                   | **Falló al compilar** (TS2322). Con `prisma generate`, OK: inmobiliaria, admin y maestros base.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `GET /health`                                                                             | 200.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Login del admin, `GET /tenants/current`                                                   | OK.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Crear localidad, propietario, inquilino, propiedad                                        | OK (la localidad hay que crearla).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Crear contrato con punitorio explícito (5 %, 10 días de gracia, ICL trimestral, depósito) | OK, `ACTIVE`, honorario 5 %.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Generar cuotas 2026-09, 10 y 11                                                           | OK; volver a generar 2026-11: "0 nuevas, 1 ya existían" (idempotente).                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Mora de octubre (vence gracia el 10/10, hoy 04/11)                                        | 25 días x 10.000 = **250.000**, correcto.                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Pago parcial de 100.000 el 13/10                                                          | Imputó 30.000 a punitorio (3 días) y 70.000 a alquiler; saldo de alquiler 130.000; resto del punitorio 22 días x 6.500 = 143.000; total 173.000. Coincide con la cuenta a mano. Recibo `R-00000001` y PDF generados.                                                                                                                                                                                                                                                                                                |
| Validaciones del pago                                                                     | Monto 0, negativo, `1e3`, 3 decimales y texto: 400. Fecha futura: `PAYMENT_INVALID_DATE`. USD sin cotización: `PAYMENT_EXCHANGE_RATE_REQUIRED`. Sin 500.                                                                                                                                                                                                                                                                                                                                                            |
| Pago mayor al saldo (250.000 sobre 200.000)                                               | Cuota cobrada y 50.000 de saldo a favor.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Liquidación                                                                               | Una pendiente: alquiler 270.000, punitorio 80.000, honorario 13.500 (5 % del alquiler), neto 336.500. Coherente.                                                                                                                                                                                                                                                                                                                                                                                                    |
| Rescisión: vista previa (notificada el 04/11, fin 31/08/2027)                             | 9 meses y 27 días, canon futuro 1.980.000, multa 198.000. Correcto. Al confirmar: contrato `Rescindido` (se ve en el listado del backoffice) y PDF de rescisión generado.                                                                                                                                                                                                                                                                                                                                           |
| Devolución de depósito, 3 contratos                                                       | **FIXED**: referencia 200.000, deducciones 20.000 (daño) y 50.000 (deuda imputada a la cuota de octubre) devuelve 130.000; la deuda crea un pago `DEPOSIT` que bajó el punitorio de octubre de 143.000 a 93.000. **FOLLOWS_RENT**: referencia = alquiler vigente (300.000), devuelve 260.000. **MANUAL**: sin monto de referencia, 400 (`DEPOSIT_RETURN_INVALID_REFERENCE`); con inconsistencia, 400 (`DEPOSIT_RETURN_UNBALANCED`); correcto, devuelve 120.000. Devolver dos veces: 409. Con contrato vigente: 409. |
| Aislamiento entre inmobiliarias (segunda inmobiliaria)                                    | Lista vacía; la propiedad, el contrato y la cuenta de la otra: 404/422 `no existe`; usar el inquilino de la otra al crear un contrato: 422.                                                                                                                                                                                                                                                                                                                                                                         |
| Inmobiliaria sin punitorio por defecto, contrato sin punitorio                            | 400 `CONTRACT_LATE_FEE_PERCENTAGE_REQUIRED` (D-228 confirmado).                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Validación de entorno                                                                     | Cada variable con `""` probada contra `validateEnv`: ver bug B3.                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| CORS                                                                                      | Con `CORS_ORIGINS` correcto, 3001 y 3002 permitidos; 3003 y `127.0.0.1:3001` no. Sin la variable: el login del navegador falla.                                                                                                                                                                                                                                                                                                                                                                                     |
| Tope por IP de lecturas públicas                                                          | Sin header o con `SITES_REVALIDATE_SECRET` mientras `SITES_SERVER_SECRET` existe: 429 desde el pedido 11. Con `SITES_SERVER_SECRET`: sin límite.                                                                                                                                                                                                                                                                                                                                                                    |
| Backoffice real con Playwright (Chrome)                                                   | Login OK; dashboard con los números de la API (cobradas 1, $200.000; honorarios $10.000; gráfico de 6 meses); propiedades (3, con filtros), contratos (3, rescindidos), cobros, parámetros e inmobiliaria cargan. Guardar parámetros (0,5 % y 7 días) hace `PATCH /tenants/current/settings` 200 y **persiste al recargar** (la API devuelve `0.50`, `7`, y el punitorio corre desde el día 8). Todas las llamadas fueron a la API real, todas 200. Capturas en `docs/capturas-auditoria-local/`.                   |

Sobre la primera captura del dashboard: mostraba "Cobradas 0" y honorarios de
$1.329,62 porque se tomó mientras los números se animaban de 0 al valor final;
repetida a los 2,5 segundos muestra 1 y $10.000, igual que la API.

## 6. Bugs y hallazgos (con pasos para reproducir)

| Id  | Severidad                                                     | Hallazgo                                                                                                                                                                                                                                                                                                                                                                                                                            | Reproducir                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1  | Media (no afecta lo básico en local; sí a sitios con tráfico) | `apps/sites` manda su `SITES_REVALIDATE_SECRET` como `X-Sites-Secret`, pero si la API tiene `SITES_SERVER_SECRET` definida (la guía decía "distinto del anterior") solo compara contra esa y el servidor de sitios queda limitado por IP. Arreglo recomendado, en el frontend: que `trustedServerHeaders()` (`apps/sites/src/lib/api.ts`) lea `SITES_SERVER_SECRET` y caiga en `SITES_REVALIDATE_SECRET`. No se tocó: es otro repo. | API con las dos variables distintas; 40 `GET /api/v1/public/<slug>/properties` seguidos con `X-Sites-Secret: <valor de SITES_REVALIDATE_SECRET>`: 429 desde el 11. Con el valor de `SITES_SERVER_SECRET`: todos 200. |
| B2  | Media para el despliegue, ninguna para local                  | `start:prod`, `start:qa`, `start:production` y el `CMD` del Dockerfile usan `dist/src/main`; el build SWC deja `dist/main.js`. Ya figura como pendiente en `docs/tecnica/fase-04.md`.                                                                                                                                                                                                                                               | `npm run build && ls dist/src` (no existe) y `npm run start:prod`.                                                                                                                                                   |
| B3  | Baja (trampa de configuración)                                | Una variable `*_PROVIDER`, `TOKKO_SOURCE`, `NODE_ENV`, `PORT`, `SECRETS_PROVIDER` o `JWT_*_TTL` con valor `""` hace fallar el arranque, pero la regla del dueño es "crear las nuevas vacías". Opción de arreglo: que `validateEnv` trate `""` como no definida para todas. No se hizo: cambia el contrato de validación y merece decisión.                                                                                          | `STORAGE_PROVIDER= node dist/main.js`: "STORAGE_PROVIDER debe ser uno de: local, cloudinary".                                                                                                                        |
| B4  | Baja                                                          | `.env.example` del backend sugiere `CORS_ORIGINS=http://localhost:3000,http://localhost:5173`, valores que no corresponden a este frontend (3001/3002).                                                                                                                                                                                                                                                                             | Leer el archivo.                                                                                                                                                                                                     |
| B5  | Baja (documentación del frontend)                             | La guía del frontend dice que `SITES_CLIENT_IP_HEADER`/`SITES_TRUSTED_PROXY_HOPS` no las lee nadie (las lee `apps/sites/src/lib/client-ip.ts`), deja `SITES_SERVER_SECRET` y CORS como "a confirmar" (ver sección 2).                                                                                                                                                                                                               | Comparar con la sección 2.                                                                                                                                                                                           |
| B6  | Informativo                                                   | Crear un contrato no genera cuotas: hay que usar "Generar cuotas" o esperar el proceso mensual. Y con el cliente de Prisma desactualizado, `tenant:create` falla al compilar.                                                                                                                                                                                                                                                       | Ver sección 5.                                                                                                                                                                                                       |
| B7  | Informativo (a decidir con Micaela)                           | Devolución en modo FOLLOWS_RENT con un depósito menor al alquiler vigente (depósito 200.000, alquiler 300.000) devuelve 260.000 tras 40.000 de deducción: más de lo recibido. Probablemente es la regla ("sigue al alquiler"), pero conviene confirmarlo.                                                                                                                                                                           | Contrato con depósito 200.000 y alquiler 300.000 en FOLLOWS_RENT; rescindir; devolver con una deducción de 40.000.                                                                                                   |

Además: la corrida mostró en el log un `WARN` de `IndicesFetchJob` ("La fuente de
índices falló"): el sandbox no tiene salida a la red de BCRA/INDEC. La API siguió
funcionando. Con red real hay que probarlo ("Traer ahora" en Configuración,
Índices).

## 7. Qué no se pudo probar

- Doppler: ni login, ni `doppler run`, ni `doppler secrets set`, ni los valores
  actuales de cada config (la lista de la sección 3 sale del código, no de
  Doppler). Tampoco el PATH del CLI en Windows ni nada específico de Windows.
- Docker y `npm run docker:dev` (se usó el Postgres local del sandbox).
  `npm run prisma:migrate` (`migrate dev`) y `prisma:seed` (demo): solo se probó
  `migrate deploy` y `tenant:create`.
- El portal de propietarios e inquilinos (3002) y `apps/sites` (3003), incluida la
  vista previa de "Mi sitio web", el aviso de publicación y los dominios propios.
- `npm run dev` de la raíz del frontend con `turbo` (se usó `next dev` directo,
  con las variables exportadas).
- Servicios externos reales: Cloudinary, Resend, Flagsmith, Tokko, Mercado
  Libre, Anthropic, y las fuentes de índices ICL/IPC.
- El resto del plan de pruebas: roles y permisos, emails, notificaciones, mora
  automática y avisos, aumentos por índice, liquidación con transferencia,
  inventarios, CRM, reportes, mobile, fechas en el borde del día.
- Las suites `npm test`, `npm run test:e2e` y `code:check` (no eran el objetivo).
