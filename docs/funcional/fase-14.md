# Fase 14 — Notificaciones y mailing (funcional)

El sistema avisa solo a inquilinos, propietarios, aseguradoras y al personal, y deja registro de cada aviso. Los textos son de la inmobiliaria y se pueden cambiar.

## Qué avisos existen

| Aviso                                                  | Para quién             | Cómo sale                                                         |
| ------------------------------------------------------ | ---------------------- | ----------------------------------------------------------------- |
| Recordatorio de pago                                   | Inquilino              | Email y link de WhatsApp                                          |
| Aviso de mora                                          | Inquilino y personal   | Email y link de WhatsApp (**obligatorio**)                        |
| Alerta a la aseguradora                                | Aseguradora            | Email (**obligatorio**)                                           |
| Contrato por vencer                                    | Propietario y personal | Email                                                             |
| Póliza por vencer / vencida                            | Personal               | Email                                                             |
| Servicio vencido                                       | Inquilino y personal   | Email y link de WhatsApp                                          |
| Liquidación confirmada                                 | Propietario            | Email con el PDF adjunto                                          |
| Consolidado cerrado                                    | Propietario            | Email con el PDF adjunto                                          |
| Recibo de pago                                         | Inquilino              | Email con el recibo. **Viene apagado**: lo decide la inmobiliaria |
| Consultas, aumentos pendientes, índices, PDFs fallidos | Personal               | Campana del sistema                                               |

Cuándo se dispara cada uno lo deciden las tareas automáticas de la Fase 13 y los eventos (liquidación, cierre, cobro); esta fase pone el texto, los canales y la entrega.

## Configuración (sólo administrador)

- **Eventos y canales**: se prende o apaga cada aviso y se elige por qué canales sale. Los obligatorios tienen candado: no se pueden apagar.
- **Plantillas**: cada aviso por email tiene asunto y texto editables, con variables que se insertan con un clic ({{nombre}}, {{monto}}, {{periodo}}...). Hay vista previa, **"enviarme una prueba"** y **"restaurar original"**. Una variable que el aviso no admite se rechaza; una variable sin dato queda vacía y el aviso sale igual.
- **WhatsApp**: textos para los botones de WhatsApp de las fichas (recordatorio, mora y primer contacto de una consulta). Los pueden leer también los empleados.
- **Historial**: todos los avisos enviados, con estado (en cola, enviado, fallido, no enviado), motivo cuando no se envió, intentos, último error y, cuando el servicio de email lo informa, si se entregó, se abrió o rebotó. Se filtra por tipo, estado, canal, destinatario y fechas.

## Si algo falla

- Un error temporal del servicio de email se **reintenta** a 1, 5 y 30 minutos. Si no sale, queda **Fallido** en el historial.
- Si el aviso era importante (mora, aseguradora, liquidación, consolidado), el personal ve una alerta en la campana.
- Un administrador puede **reenviar** un aviso fallido, o **reintentar todos** los fallidos de una vez (con barra de avance).
- Si un mail rebota o lo marcan como spam, aparece una alerta para corregir el email cargado.
- Un inquilino o propietario **sin email** no frena al resto: su aviso queda "No enviado: sin email" y sale solo cuando se cargue el dato.

## Preferencias de cada persona del personal

Cada administrador o empleado elige, en **Perfil → Mis notificaciones**, qué avisos quiere recibir por email y cuáles ver en la campana. Lo que apaga una persona no afecta a las demás. Los obligatorios no se pueden apagar. Cada persona del personal recibe su propio mail.

## Qué todavía depende de cuentas externas

El envío real necesita una cuenta de Resend con el dominio verificado; sin ella los mails se **muestran en el log del servidor** y todo el resto (historial, reintentos, plantillas) se prueba igual. Que los mails lleguen a la bandeja principal y no a spam depende de la configuración del dominio, que no se puede probar en local.

## Modo de envío del consolidado (ver D-229)

El mail de cada liquidación y el del consolidado respetan lo elegido para el propietario (sólo resumen, sólo comprobantes o ambos). Los comprobantes retenidos salen al cerrar el mes si se elige un modo que los incluye.
