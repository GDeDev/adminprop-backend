# 0001 — Quedarse en NestJS 11 y no pasar a 12

**Fecha:** 2026-09-18
**Estado:** Aceptada. Revisar cuando cambie alguna de las condiciones de abajo.

## Contexto

El proyecto venía con NestJS 10 y versiones mezcladas (cqrs 11 y terminus 11
sobre core 10). Se migró todo a la 11 y se evaluó si convenía llegar hasta la
12, que es la major actual.

## Qué se probó

Se hizo un spike completo en una rama aparte: todos los `@nestjs/*` a 12,
TypeScript a 6.0.3 y `@swc/cli` a 0.8.1.

Se resolvieron, en orden, estos problemas:

1. Conflicto de peer dependency con `@swc/cli` → se subió a 0.8.1.
2. TS 6 deprecó `baseUrl` → `ignoreDeprecations: "6.0"`.
3. Dejó de descubrir `@types/jest` solo → `types: ["node", "jest"]` explícito.
4. `import * as compression` dejó de ser invocable → `esModuleInterop`.
5. `ThrottlerAsyncOptions` pasó a exigir `imports`.

Con eso, **`tsc --noEmit` quedó limpio**. El bloqueo real vino después.

## El bloqueo

Nest 12 publica **todos** sus paquetes core como ESM. Jest corre en CommonJS:

```
SyntaxError: Cannot use import statement outside a module
```

Se intentó el fix habitual, dejar pasar los paquetes por el transform:

```js
transformIgnorePatterns: ['node_modules/(?!(@nestjs|uuid)/)']
```

Y apareció el bloqueo de fondo:

```
SyntaxError: Cannot use 'import.meta' outside a module
```

`import.meta` no es traducible a CommonJS: es sintaxis que sólo existe en
módulos ES. No hay configuración de Jest que lo resuelva mientras el runner
corra en CJS. Quedaron 5 de 7 suites en rojo.

Las salidas eran:

- **Jest en modo ESM** (`--experimental-vm-modules` + preset ESM de ts-jest).
  Frágil con `emitDecoratorMetadata`, que es la base de la inyección de
  dependencias de Nest y de class-validator.
- **Migrar a Vitest**, que es ESM nativo. Toca las 7 suites (`jest.fn` → `vi.fn`,
  mocks, configuración) y es un proyecto en sí mismo.

## Decisión

Quedarse en **NestJS 11 + TypeScript 5**.

El spike se descartó. Se rescató `esModuleInterop` y el cambio a imports por
defecto, que valen por sí solos y achican el salto futuro.

## Por qué no duele

- Express 5, que es el breaking change de fondo, **ya ocurre en la 11**. No
  estamos difiriendo esa migración.
- TypeScript 7 está bloqueado igual en cualquiera de las dos versiones:
  `@typescript-eslint` declara `<6.1.0` y todavía no hay una major que soporte
  la 7. El techo de TS es 6.0.3 con o sin Nest 12.
- Lo único que se pierde de la 12 es `@nestjs/observe` (observabilidad nativa),
  y eso se puede cubrir con OpenTelemetry a mano sobre la 11.

## Cuándo revisar

Cuando se cumpla **cualquiera** de estas:

1. `ts-jest` publique soporte ESM estable con `emitDecoratorMetadata`.
2. Se decida migrar a Vitest por otro motivo — ahí el costo ya está pagado.
3. NestJS 11 se acerque a fin de soporte.
4. Se necesite `@nestjs/observe` puntualmente y no alcance con OpenTelemetry.

Cuando se retome, los cinco arreglos de la sección "Qué se probó" siguen siendo
válidos y son el punto de partida.
