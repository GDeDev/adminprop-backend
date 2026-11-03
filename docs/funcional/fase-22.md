# Fase 22 — Portal público (funcional)

Es la vitrina de la inmobiliaria: cualquier persona puede ver las propiedades disponibles y escribir una consulta, sin cuenta ni contraseña.

## Qué ve el público

- **Listado** de las propiedades disponibles, las más nuevas primero, con foto de portada, dirección, tipo, barrio, precio y comodidades. Se puede filtrar por ubicación, tipo de propiedad y rango de precio (en pesos o dólares).
- **Ficha** de cada propiedad: todas las fotos, la descripción, tipo y ubicación, y el formulario para consultar.
- **Precio**: si la propiedad no tiene precio cargado se muestra "Consultar".
- Una propiedad que se alquila, entra en mantenimiento o se borra **desaparece sola** del portal; si alguien tenía el link, ve un aviso de que ya no está disponible.
- No se muestra nunca información del propietario, de los contratos ni las notas internas.

## Cómo se cargan los datos desde el backoffice

Al crear o editar una propiedad hay tres campos nuevos, todos opcionales:

1. **Precio de publicación** y **moneda** (por defecto, la de la inmobiliaria). Vacío o cero significa "Consultar".
2. **Descripción pública** (hasta 2000 caracteres): lo que lee el público. Es distinta de las notas internas, que no salen nunca.

No hay un botón de "publicar": una propiedad **Disponible** se ve en el portal y una en cualquier otro estado, no. Para ocultar una disponible, se pasa a "En mantenimiento".

## Consultas

1. La persona completa nombre, email, mensaje y, si quiere, teléfono. Si viene desde una ficha, la consulta queda asociada a esa propiedad.
2. Al enviar, el personal recibe un **aviso en la campana** del backoffice y, si la inmobiliaria tiene email de contacto cargado, un **correo** con los datos (se puede responder directo al consultante).
3. El personal ve las consultas en la lista de consultas, las filtra por estado o por propiedad y las marca como **Nueva**, **Contactada** o **Cerrada**. El tablero del CRM (Fase 23) las va a usar.

## Protección contra spam

- Un campo oculto en el formulario: si algo lo completa (un robot), la consulta se descarta sin avisarle.
- Máximo **5 consultas por hora** por conexión y por email. Si se pasa, el portal pide reintentar más tarde o escribir por WhatsApp.
- Las lecturas del listado también tienen un tope por conexión.

## Reglas

- Cada inmobiliaria tiene su propio portal, identificado por su nombre corto (slug). Una inmobiliaria deshabilitada o inexistente no muestra nada.
- Cada inmobiliaria ve sólo sus propias consultas.
- Las consultas quedan en el historial de auditoría (el cambio de estado incluido).

## Todavía no

- Ambientes, baños y superficie en las propiedades (hoy no se cargan, así que no se muestran).
- Ocultar una propiedad disponible sin cambiarle el estado.
- Reducir la dirección a barrio si una inmobiliaria no quiere mostrarla completa.
- CAPTCHA.
