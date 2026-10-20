# Fase 7 — Propietarios (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-07.md`.

- **Cargar un propietario:** nombre, apellido, DNI o CUIT, teléfono, email, dirección, observaciones y, si se tienen, los datos bancarios (CBU, alias, banco, titular). El DNI se guarda sin puntos: "20.123.456" y "20123456" son la misma persona, y no se puede cargar dos veces en la misma inmobiliaria (otra inmobiliaria sí puede tener al mismo propietario).
- **CBU:** se verifica que sea un CBU real (no sólo que tenga 22 dígitos): un número mal tipeado se rechaza antes de que una transferencia rebote. Si otro propietario ya tiene el mismo CBU, el sistema avisa pero deja cargarlo (puede ser una cuenta compartida).
- **Datos bancarios aparte:** se cambian desde una acción propia, separada de los datos personales, y cada cambio queda registrado con quién lo hizo, cuándo y qué valor había antes. Es la protección contra el fraude de "cambio de CBU".
- **Honorario reducido:** el sistema calcula solo si al propietario le toca la comisión reducida por tener varias propiedades activas (por defecto desde 3; cada inmobiliaria define su número). No se guarda: se recalcula cada vez, así siempre refleja la situación actual. Hasta que existan los contratos, "activa" quiere decir "alquilada".
- **Ficha:** datos, cuenta bancaria, sus propiedades con estado, y el lugar donde va a aparecer el historial de liquidaciones cuando exista esa parte.
- **Acceso al portal:** desde la ficha se genera el usuario del propietario (su email) y una contraseña que se muestra **una sola vez**. Si la pierde, se genera otra y la anterior deja de servir. Sin email cargado no se puede generar.
- **Buscar:** por nombre, apellido o DNI, sin importar acentos ni el orden ("perez jose" encuentra a "José Pérez").
- **Eliminar:** sólo un administrador, y sólo si el propietario no tiene propiedades asignadas (primero se reasignan). Al eliminarlo se le corta el acceso al portal.
- **Propiedades:** ahora una propiedad sólo acepta propietarios que existan en la misma inmobiliaria, y muestra su nombre en la ficha.
