# Fase 23 — CRM y multipublicación (funcional)

Qué hace el sistema para el personal de la inmobiliaria. Detalle técnico en [`../tecnica/fase-23.md`](../tecnica/fase-23.md).

## Consultas y tablero

- Toda consulta que llega por el **portal público** entra sola en la columna **Nuevas**, sin responsable. También se pueden **cargar a mano** (llamado, WhatsApp, visita espontánea) y llegan solas las de Mercado Libre.
- Las columnas son: **Nuevas → Contactadas → Visita agendada → Propuesta enviada → Ganadas / Perdidas**. Una tarjeta se arrastra entre columnas y dentro de una columna; el orden queda como se dejó.
- Cerrar una consulta como **Perdida** pide el motivo («No respondió», «Eligió otra propiedad», «Precio», «Ya no busca», «Otro» o un texto propio). Cerrar como **Ganada** permite vincular un contrato. Se puede **reabrir** una cerrada.
- Una consulta puede no tener propiedad («Consulta general»). Si la propiedad ya no está disponible, la tarjeta lo indica pero no se bloquea.
- Se puede **asignar** a una persona del personal activo, **buscar** por nombre, contacto o mensaje y **filtrar** por responsable (incluye «Sin asignar»), propiedad y canal.
- Cada consulta tiene una **línea de tiempo**: alta, cambios de columna, asignaciones, seguimientos, ediciones, intentos de contacto y **notas**. Las notas no se editan ni se borran.

## Seguimiento y WhatsApp

- Se puede fijar una **fecha de seguimiento**. Cuando llega, el sistema avisa una vez en la campana (a todo el personal, nombrando a la persona asignada si la hay).
- Al asignarle una consulta a alguien, se le avisa (salvo que se la asigne a sí mismo).
- El botón **WhatsApp** abre el chat con el mensaje de la plantilla «Primer contacto con una consulta» (editable en Configuración) y registra el intento de contacto; la consulta pasa de Nuevas a Contactadas. Sin teléfono utilizable, el botón no aparece.

## Analítica

- **Por propiedad**: vistas de la ficha pública, consultas recibidas (por columna y por canal), conversión (ganadas sobre consultas) y evolución diaria. Las vistas se cuentan **desde la activación de esta fase**; antes figuran en cero. No se guarda ningún dato personal de quien mira, y una misma persona no suma más de una vista cada 30 minutos.
- **General**: consultas abiertas, sin asignar, tiempo promedio hasta el primer contacto, conversión y las cinco propiedades con más consultas.

## Multipublicación

- En **Configuración → Canales de publicación** el administrador conecta la cuenta de **Mercado Libre** (se le pide permiso al portal y se vuelve al sistema) o la desconecta. Al desconectar, lo ya publicado queda en el portal. **Zonaprop y Argenprop figuran como no disponibles**: requieren un acuerdo comercial.
- En la **ficha de la propiedad** hay una tarjeta por canal con su estado, el enlace al aviso y las acciones **Publicar / Actualizar / Pausar / Reanudar / Cerrar / Reintentar**. Para publicar, la propiedad tiene que estar disponible y tener precio, al menos una foto y descripción pública; si falta algo, el sistema lo lista.
- Si se edita una propiedad ya publicada, la ficha muestra **«Hay cambios sin publicar»** con el botón para actualizar el aviso.
- Publicar corre en segundo plano y muestra el avance. Si el portal rechaza el aviso o el permiso venció, la publicación queda en **error** con el motivo y se puede reintentar (o reconectar la cuenta); en el segundo caso además se avisa en la campana.
- Cuando una propiedad se **alquila**, sus publicaciones activas se cierran solas. Si se libera de nuevo, hay que publicarla otra vez.
- Las consultas que llegan por Mercado Libre se traen cuatro veces por día y aparecen como **Nuevas**; suelen no traer teléfono ni email porque se contestan dentro del portal.

## Qué no incluye

Zonaprop y Argenprop, importar o exportar el CRM a Excel, asignación automática y el acceso de propietarios o inquilinos a las consultas. La publicación en Mercado Libre real depende de tener una aplicación y una cuenta de prueba en su portal para desarrolladores.
