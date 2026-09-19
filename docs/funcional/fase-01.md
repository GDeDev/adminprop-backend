# Fase 1 — Arquitectura (resumen funcional)

> Para quien no programa. El detalle técnico está en `docs/tecnica/fase-01.md`.

Esta fase no agrega pantallas ni funciones que se usen todos los días. Arma las
reglas fijas sobre las que se construye todo lo demás. Lo que cambia para el
negocio:

## Cada inmobiliaria ve sólo lo suyo

Adminprop está pensado para muchas inmobiliarias a la vez; Oppido es la
primera. Cada usuario pertenece a una inmobiliaria, y el sistema filtra solo
todo lo que ese usuario puede ver o tocar. Si alguien intenta abrir un dato de
otra inmobiliaria (por ejemplo, adivinando un link), el sistema responde que
no existe, sin confirmar que existe en otro lado.

Los parámetros de cada inmobiliaria ya tienen su lugar, con los valores por
defecto acordados: honorarios estándar (5%) y reducido (3%), desde cuántas
propiedades aplica el reducido (3), días de gracia (10), punitorio diario
(5%), día de generación de cuotas (28), día de recordatorio (1), aviso de
vencimiento (60 días), día del informe mensual (10) y moneda (ARS). Cada
inmobiliaria podrá tener los suyos sin tocar el sistema.

Si una inmobiliaria se da de baja, ninguno de sus usuarios puede entrar.

## Quién puede entrar

- Cuatro tipos de usuario: **administrador** y **empleado** (usan el
  backoffice), **propietario** e **inquilino** (usan su portal, llegan en
  fases posteriores).
- No hay registro abierto: los usuarios los crea la inmobiliaria. La pantalla
  de alta de empleados llega en la Fase 4.

## La plata no pierde centavos

Todos los montos se calculan con precisión exacta y se redondean siempre de la
misma forma: al centavo, y los medios centavos hacia arriba. Ejemplo acordado:
un 5% sobre $150.333,33 da $7.516,67.

## Las tareas pesadas no cuelgan la pantalla

Las acciones que tocan muchos registros (reenviar recordatorios a todos los
morosos, regenerar los PDFs del mes) se ejecutan en segundo plano. El usuario
recibe enseguida un aviso de "en proceso" y puede ver el avance. Si algo falla
a mitad de camino, el sistema reintenta solo.

## Historial de cambios

Cada cambio importante queda registrado: quién lo hizo, cuándo, qué dato
cambió, y el valor anterior y el nuevo. La pantalla para consultarlo llega en
la Fase 20.

## Funciones que se prenden por inmobiliaria

Una función nueva se puede habilitar primero sólo para una inmobiliaria (por
ejemplo, para probarla con Oppido) y después para el resto, sin actualizar el
sistema.

## Preparado para crecer

Los archivos (fotos, PDFs), los emails, la cola de tareas y las claves de
acceso a servicios externos pasan por piezas intercambiables. El día que haga
falta mudarse a una infraestructura más grande, se cambian esas piezas y no
las reglas del negocio.
