# Archivos (`StoragePort`)

Spec Fase 1, sección 5.2. Un módulo de negocio sube y borra archivos sólo a
través de `StoragePort` (`@/platform/storage/storage.port`); el único archivo
que importa el SDK de Cloudinary es su adapter.

```ts
const stored = await this.storage.upload(buffer, `properties/${id}/front.jpg`)
// → { url: 'https://…', key: 'image:tenants/<tenantId>/properties/<id>/front' }

await this.storage.delete(stored.key)
```

- **Por tenant**: el `path` es relativo al tenant del contexto; el adapter lo
  guarda bajo `tenants/<tenantId>/`. Borrar una key de otro tenant falla. Sin
  tenant en el contexto, falla.
- **Guardar la `key`, no sólo la URL**: es lo que identifica al archivo en el
  proveedor. La URL puede cambiar (CDN, dominio propio).
- **Paths seguros**: sólo letras, números, `.`, `_` y `-` por segmento; nada de
  `..`.

## Proveedores (`STORAGE_PROVIDER`)

| Valor             | Para                 | Notas                                                                        |
| ----------------- | -------------------- | ---------------------------------------------------------------------------- |
| `local` (default) | desarrollo y tests   | Disco en `STORAGE_LOCAL_DIR` (`storage-data/`), servido en `/files`          |
| `cloudinary`      | entornos desplegados | Exige `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` |

Las credenciales se validan al arrancar sólo si el proveedor está elegido.
Mañana, S3: un `S3StorageAdapter` y un `case` en `storage.module.ts`.
