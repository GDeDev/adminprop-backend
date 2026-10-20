# Fase 4 — Login y usuarios (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-04.md`.

## Dos puertas de entrada

- **Backoffice** (administradores y empleados de la inmobiliaria): se entra con
  email y contraseña. Un email de empleado no se puede repetir en todo el
  sistema, aunque sea en otra inmobiliaria.
- **Portal** (propietarios e inquilinos): se entra por el portal de la
  inmobiliaria, con email y contraseña, eligiendo "propietario" o "inquilino".
  Una misma persona puede ser propietaria en dos inmobiliarias distintas con el
  mismo email: cada portal la reconoce sólo en su inmobiliaria, y nunca ve
  datos de la otra. También puede ser propietaria e inquilina en la misma
  inmobiliaria.

Un propietario no puede entrar al backoffice, ni un empleado al portal.

## Qué ve quien se equivoca

Email inexistente, contraseña incorrecta o usuario desactivado: siempre el
mismo mensaje, "Email o contraseña incorrectos". Así nadie puede averiguar
probando qué emails están registrados.

Protecciones contra quien intenta adivinar contraseñas:

- Desde una misma conexión, más de 5 intentos por minuto quedan frenados un
  rato.
- Una cuenta con 5 contraseñas equivocadas seguidas se bloquea 15 minutos.

## La sesión

- Al entrar, la sesión dura 15 minutos y se renueva sola mientras la persona
  use el sistema, hasta 7 días.
- "Cerrar sesión" la corta en el acto.
- Si un administrador desactiva a un empleado, o si la inmobiliaria se da de
  baja, esa persona queda afuera en su próximo clic, aunque tenga la pantalla
  abierta.

## Gestión de usuarios (sólo administradores)

Un administrador puede, sobre los usuarios de su inmobiliaria:

- ver la lista, filtrar por rol (administrador o empleado) y por activo;
- crear un empleado o un administrador, con una contraseña inicial que le pasa
  a la persona (después ella la puede cambiar);
- editar nombre, apellido, email y rol;
- desactivar a alguien (no se borra: queda en el historial y se puede volver a
  activar);
- ponerle una contraseña nueva a quien se la olvidó (le cierra todas las
  sesiones abiertas).

Para que la inmobiliaria nunca se quede sin administrador, nadie puede quitarse
a sí mismo el rol de administrador ni desactivarse. Para cambiar la propia
contraseña está la opción "Cambiar contraseña", que pide la actual.

Los empleados no ven esta sección. Los accesos de propietarios e inquilinos se
van a crear desde su ficha, cuando lleguen esas pantallas (Fases 7 y 8).

## Para probar en desarrollo

Inmobiliaria demo (`demo`):

| Quién       | Email                    | Contraseña           |
| ----------- | ------------------------ | -------------------- |
| Admin       | `admin@demo.local`       | `demo-admin-1234`    |
| Empleado    | `empleado@demo.local`    | `demo-employee-1234` |
| Propietario | `propietario@demo.local` | `demo-owner-1234`    |
| Inquilino   | `inquilino@demo.local`   | `demo-renter-1234`   |
