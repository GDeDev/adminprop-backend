# Code Formatting and Linting Guide

Este proyecto utiliza **Prettier** y **ESLint** para mantener un código consistente y de alta calidad.

## 🛠️ Herramientas Configuradas

- **Prettier**: Formateo automático de código
- **ESLint**: Análisis estático y detección de errores
- **Husky**: Git hooks para automatización
- **lint-staged**: Formateo automático en pre-commit

## 📋 Scripts Disponibles

### Formateo de Código

```bash
# Formatear archivos TypeScript específicos
npm run format

# Verificar si el código está bien formateado (sin modificar)
npm run format:check

# Formatear todos los archivos del proyecto
npm run format:all
```

### Linting

```bash
# Ejecutar ESLint y arreglar errores automáticamente
npm run lint

# Solo verificar errores sin arreglar
npm run lint:check

# Arreglar errores de ESLint
npm run lint:fix
```

### Scripts Combinados

```bash
# Verificar formateo y linting (sin modificar archivos)
npm run code:check

# Formatear y arreglar errores automáticamente
npm run code:fix
```

## ⚙️ Configuración

### Prettier (`.prettierrc`)

```json
{
  "singleQuote": true,
  "trailingComma": "all",
  "semi": true,
  "tabWidth": 2,
  "useTabs": false,
  "printWidth": 80,
  "bracketSpacing": true,
  "arrowParens": "avoid",
  "endOfLine": "lf"
}
```

### ESLint (`.eslintrc.js`)

- Configurado para TypeScript
- Integrado con Prettier
- Reglas personalizadas para NestJS

### VS Code (`.vscode/settings.json`)

- Formateo automático al guardar
- ESLint integrado
- Prettier como formateador por defecto

## 🚀 Git Hooks (Pre-commit)

El proyecto está configurado con **Husky** y **lint-staged** para:

1. **Formatear automáticamente** el código antes de cada commit
2. **Ejecutar ESLint** y arreglar errores automáticamente
3. **Prevenir commits** con código mal formateado

### Configuración (package.json)

```json
{
  "lint-staged": {
    "*.{ts,js}": ["prettier --write", "eslint --fix"],
    "*.{json,md}": ["prettier --write"]
  }
}
```

## 🔧 Solución de Problemas

### 1. Errores de Formateo

```bash
# Formatear todo el proyecto
npm run code:fix

# Solo verificar problemas
npm run code:check
```

### 2. Conflictos entre Prettier y ESLint

La configuración está diseñada para evitar conflictos:

- `eslint-config-prettier`: Desactiva reglas de ESLint que pueden conflictuar
- `eslint-plugin-prettier`: Ejecuta Prettier como regla de ESLint

### 3. Pre-commit Hook No Funciona

```bash
# Reinstalar husky
npx husky install

# Verificar permisos
chmod +x .husky/pre-commit
```

### 4. Archivo Específico No Se Formatea

Verificar si está en `.prettierignore`:

```bash
# Ver archivos ignorados
cat .prettierignore

# Formatear archivo específico
npx prettier --write src/path/to/file.ts
```

## 📝 Integración con Editor

### VS Code (Recomendado)

1. Instalar extensiones:

   - **Prettier - Code formatter**
   - **ESLint**

2. La configuración en `.vscode/settings.json` habilitará:
   - Formateo automático al guardar
   - Arreglo automático de ESLint al guardar

### Otros Editores

- **WebStorm/IntelliJ**: Prettier y ESLint se detectan automáticamente
- **Vim/Neovim**: Usar plugins como `coc-prettier` y `coc-eslint`
- **Sublime Text**: Instalar `JsPrettier` y `SublimeLinter-eslint`

## 🚦 Estado del Código

Para verificar el estado actual del código:

```bash
# Estado completo
npm run code:check

# Solo formateo
npm run format:check

# Solo linting
npm run lint:check
```

## 🔄 Workflow Recomendado

1. **Durante desarrollo**: VS Code formateará automáticamente al guardar
2. **Antes de commit**: El pre-commit hook ejecutará automáticamente
3. **En CI/CD**: Ejecutar `npm run code:check` para verificar

## 📚 Referencias

- [Prettier Documentation](https://prettier.io/docs/en/)
- [ESLint Documentation](https://eslint.org/docs/)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged Documentation](https://github.com/okonet/lint-staged)
