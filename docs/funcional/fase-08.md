# Fase 8 — Inquilinos y garantes (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-08.md`.

- **Cargar un inquilino:** nombre, apellido, DNI o CUIT, teléfono, email, dirección, fecha de ingreso, observaciones y, si tiene, su garante. El DNI se guarda sin puntos: "30.123.456" y "30123456" son la misma persona, y no se puede cargar dos veces en la misma inmobiliaria (otra inmobiliaria sí puede tener al mismo inquilino). El garante es opcional: se puede cargar después.
- **Cargar un garante:** nombre, apellido, DNI, teléfono, email, dirección, el tipo de garantía (un inmueble propio o recibos de sueldo) y el detalle: la dirección y datos del inmueble, o el empleador y el sueldo aproximado. El detalle es texto libre pero no puede quedar vacío. Una misma persona puede ser garante de varios inquilinos.
- **Vincular:** desde la ficha del inquilino se elige o se cambia el garante. Sólo se aceptan garantes de la misma inmobiliaria. Cada cambio de garante queda registrado con quién lo hizo, cuándo y cuál era el anterior.
- **Ficha del inquilino:** sus datos, el garante completo (con tipo y detalle de la garantía), y los lugares donde van a aparecer el contrato activo y el historial de pagos cuando existan esas partes del sistema.
- **Ficha del garante:** sus datos y la lista de inquilinos que garantiza.
- **Acceso al portal:** desde la ficha se genera el usuario del inquilino (su email) y una contraseña que se muestra **una sola vez**. Si la pierde, se genera otra y la anterior deja de servir. Sin email cargado no se puede generar.
- **Buscar:** inquilinos y garantes por nombre, apellido o DNI, sin importar acentos ni el orden ("lopez ivan" encuentra a "Iván López"). Los filtros por estado de pago y por propiedad ya están previstos en la API pero recién van a filtrar cuando existan los cobros y los contratos.
- **Eliminar:** sólo un administrador. Un inquilino no se puede eliminar si tiene un contrato activo (hoy todavía no hay contratos); al eliminarlo se le corta el acceso al portal. Un garante no se puede eliminar mientras algún inquilino lo tenga como garante: primero se les cambia el garante.
