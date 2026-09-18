# Configuración y secretos

Todo se configura por variables de entorno. Se validan **una sola vez al
arrancar**: si falta algo o está mal tipado, el proceso muere ahí con un mensaje
que dice qué, en vez de explotar a mitad de un request en producción.

```
$ npm start

❌ Configuración de entorno inválida:
  • DATABASE_URL: DATABASE_URL es obligatoria
  • JWT_ACCESS_SECRET: JWT_ACCESS_SECRET debe tener al menos 32 caracteres.
    Generá uno con: openssl rand -base64 48

Revisá tu archivo .env (usá .env.example como referencia).
```

## Cómo está armado

```
src/shared/config/
├── env.validation.ts     # Contrato de las env vars (class-validator)
├── configuration.ts      # Env validado → objeto tipado por namespace
├── config.module.ts      # ConfigModule global
└── secrets/
    ├── secrets-loader.interface.ts   # Puerto para un secret manager externo
    ├── env-secrets.loader.ts         # Implementación por defecto (no-op)
    └── load-secrets.ts               # Se llama en main.ts antes de crear la app
```

**Nada del resto de la app lee `process.env` directamente.** Todo pasa por
`ConfigService`, tipado:

```ts
import { ConfigService } from '@nestjs/config'
import { Configuration, JwtConfig } from '@/shared/config/configuration'

constructor(configService: ConfigService<Configuration, true>) {
  const jwt = configService.get<JwtConfig>('jwt', { infer: true })
  //    ^? JwtConfig, no `any`
}
```

Namespaces disponibles: `app`, `database`, `jwt`, `accountLock`, `throttle`,
`cors`.

## Agregar una variable

1. Declarala en `EnvironmentVariables` (`env.validation.ts`) con sus reglas.
2. Mapeala al namespace que corresponda en `configuration()`.
3. Documentala en `.env.example`.

Los tres pasos: si salteás el primero, la variable no se valida y llega
`undefined` a producción.

## Secretos

Hoy los secretos vienen de variables de entorno (`SECRETS_PROVIDER=env`). En
desarrollo salen de `.env`; en producción los inyecta la plataforma (secrets de
Kubernetes, task definition de ECS, etc.).

> **`.env` nunca se commitea ni se hornea en la imagen Docker.** Está en
> `.gitignore` y en `.dockerignore`.

### Enchufar un secret manager externo

`loadSecrets()` corre en `main.ts` **antes** de instanciar Nest y su trabajo es
hidratar `process.env`. Así el resto de la app no se entera de dónde vino cada
valor y la validación de entorno sigue siendo la única puerta de entrada.

Para agregar un proveedor (AWS Secrets Manager, Vault, Doppler, Infisical, GCP
Secret Manager):

1. Implementá `SecretsLoader` en `src/shared/config/secrets/`:

   ```ts
   export class VaultSecretsLoader implements SecretsLoader {
     readonly name = 'vault'

     async load(): Promise<Record<string, string>> {
       const response = await fetch(
         process.env.VAULT_ADDR + '/v1/secret/data/api',
         {
           headers: { 'X-Vault-Token': process.env.VAULT_TOKEN },
         },
       )
       const { data } = await response.json()
       return data.data
     }
   }
   ```

2. Registralo en `LOADERS` (`load-secrets.ts`).
3. Agregá la clave al enum `SecretsProvider` (`env.validation.ts`).
4. Levantá con `SECRETS_PROVIDER=vault`.

Los valores que ya existen en `process.env` **no se pisan**: podés sobrescribir
uno puntual en local sin tocar el proveedor.

## Variables

Referencia completa y comentada en [`.env.example`](../.env.example). Las
obligatorias son sólo tres:

| Variable             | Requisito                                   |
| -------------------- | ------------------------------------------- |
| `DATABASE_URL`       | —                                           |
| `JWT_ACCESS_SECRET`  | ≥ 32 caracteres                             |
| `JWT_REFRESH_SECRET` | ≥ 32 caracteres y **distinto** al de access |

```bash
openssl rand -base64 48   # una vez para cada uno
```

## Defaults que dependen del entorno

Algunos valores cambian solos según `NODE_ENV`, para que lo seguro sea el
default:

| Variable          | development | production |
| ----------------- | ----------- | ---------- |
| `SWAGGER_ENABLED` | `true`      | `false`    |
| `LOG_LEVEL`       | `debug`     | `info`     |
| `TRUST_PROXY`     | `false`     | `true`     |
| `hsts` (helmet)   | apagado     | encendido  |

**CORS está cerrado por defecto en todos los entornos.** Sin `CORS_ORIGINS` no
se habilita ningún origen y la app lo avisa por log al arrancar. Es
deliberadamente incómodo: el template traía `app.enableCors()` sin argumentos,
que deja entrar a cualquier sitio.
