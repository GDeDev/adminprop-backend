# Fase 6 — Propiedades (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-06.md`.

- **Cargar una propiedad:** dirección, ubicación (provincia, localidad y, si se quiere, barrio), tipo, amenities, observaciones internas y hasta 20 fotos. Queda "disponible". Si alguien deja la carga por la mitad, al volver se le ofrece seguir donde estaba.
- **Listado:** en el celular, tarjetas con foto; en la computadora, una tabla. Se filtra por estado y por tipo, y se busca por parte de la dirección ("corrientes" encuentra "Av. Corrientes 1234").
- **Ficha:** fotos para deslizar, datos, amenities, observaciones internas (nunca salen en el portal) y los lugares donde van a aparecer el propietario, el contrato y los pagos cuando existan esas partes.
- **Estados:** disponible, alquilada, en mantenimiento. A mano se puede pasar de disponible a alquilada (una reserva) o a mantenimiento, de alquilada a disponible o a mantenimiento, y de mantenimiento a disponible. Cuando existan los contratos, una propiedad con contrato activo no vuelve a disponible a mano: se hace terminando el contrato.
- **Eliminar:** sólo un administrador, y sólo si la propiedad nunca tuvo contratos (si los tuvo, se la pasa a mantenimiento).
- Un tipo o una ubicación que después se desactiva sigue apareciendo en las propiedades que ya lo usaban.
