# Aviso de seguridad sobre variables de entorno

> Guía completa de configuración: **[CONFIGURATION.md](./CONFIGURATION.md)**.

## Lo esencial

**Los secretos viven en Doppler, nunca en un archivo.** `.env.example` sólo
documenta qué variables existen; sus valores son obviamente falsos.

**No se crea `.env`.** La app lo ignora aunque exista, y sigue listado en
`.gitignore` y `.dockerignore` por las dudas. Si alguna vez se commitea un
secreto, hay que rotarlo: borrarlo del repo no lo saca del historial de git.

## Antes de arrancar

```bash
doppler login
doppler setup   # config dev_backend
```

Los dos secretos JWT tienen que ser **distintos entre sí**: la validación de
entorno no deja arrancar si son iguales.

```bash
openssl rand -base64 48   # JWT_ACCESS_SECRET
openssl rand -base64 48   # JWT_REFRESH_SECRET
```

Si compartieran secreto, un refresh token serviría como access token.

## En producción

Inyectá los secretos como **variables de entorno desde la plataforma** —secrets
de Kubernetes, task definition de ECS, variables del proveedor de hosting—, no
como un archivo dentro de la imagen.

Si preferís un secret manager externo (AWS Secrets Manager, Vault, Doppler,
Infisical, GCP Secret Manager), hay un punto de extensión pensado para eso:
implementás `SecretsLoader` y lo registrás. Los pasos están en
[CONFIGURATION.md](./CONFIGURATION.md#enchufar-un-secret-manager-externo).

## Checklist

- [ ] `.env` no está en git (`git check-ignore .env` debe responder `.env`)
- [ ] `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` generados al azar y distintos
- [ ] `DATABASE_URL` con un usuario con los permisos mínimos necesarios
- [ ] `CORS_ORIGINS` con la lista explícita de orígenes, nunca `*`
- [ ] `SWAGGER_ENABLED=false` en producción (es el default)
- [ ] Los secretos se rotan periódicamente

## Si se filtró un secreto

1. **Rotá el secreto**, no lo borres y ya.
2. Si fue un `JWT_*`: al cambiarlo se invalidan todos los tokens vigentes y
   todos los usuarios quedan deslogueados. Es lo que querés.
3. Si fue la base: cambiá la contraseña y revisá los accesos recientes.
4. Purgá el valor del historial de git (`git filter-repo`) y forzá el push
   coordinando con el equipo.
