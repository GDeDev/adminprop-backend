# Fase 5 — Maestros (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-05.md`.

Los "maestros" son las listas que aparecen en los desplegables del sistema: tipos de propiedad, amenities, tipos de operación, tipos de servicio y ubicaciones. En vez de escribirlos a mano cada vez, se eligen de una lista prolija, y eso deja los datos consistentes (clave para la migración desde Tokko).

## Cada inmobiliaria tiene sus listas

Cada inmobiliaria arranca con una lista base y la ajusta a su gusto sin afectar a las demás. La lista base:

- **Tipos de propiedad:** Casa, Departamento, PH, Local, Oficina, Terreno.
- **Tipos de operación:** Alquiler, Venta, Temporario.
- **Tipos de servicio:** Alquiler, Expensas, Luz, Gas, Agua, Municipal, Seguro.
- **Amenities:** Pileta, Cochera, Parrilla, Balcón, Terraza, Ascensor (cada una con su ícono).
- **Ubicaciones:** Argentina, con Buenos Aires y la Ciudad de Buenos Aires. El resto (localidades y barrios reales) se va a cargar desde Tokko.

## Qué se puede hacer

- Los administradores agregan, renombran, desactivan y reactivan valores. Los empleados los ven pero no los cambian.
- **Nada se borra.** Desactivar un valor lo saca de los desplegables, pero lo que ya lo usaba lo sigue mostrando. Por ejemplo, si se desactiva "Galpón", las propiedades que ya eran galpones siguen diciendo "Galpón".
- No se pueden repetir nombres ("Casa" y "casa" cuentan como el mismo).
- **Ubicaciones:** van en árbol, País → Provincia → Localidad → Barrio. Un barrio siempre tiene que estar dentro de algo, y no puede haber dos barrios con el mismo nombre en la misma localidad (sí en localidades distintas).
