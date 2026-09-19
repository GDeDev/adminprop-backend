module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin', 'boundaries'],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:prettier/recommended',
    'prettier',
  ],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js'],
  settings: {
    // Resuelve el alias `@/` para que boundaries sepa a qué carpeta apunta
    // cada import.
    'import/resolver': { typescript: { project: 'tsconfig.json' } },
    // Fronteras del monolito modular (spec Fase 1, sección 5.1). Los patrones
    // se evalúan en orden: el primero que matchea define el tipo del archivo.
    'boundaries/elements': [
      {
        type: 'module-public',
        pattern: 'src/modules/*/public/**',
        mode: 'full',
        capture: ['module'],
      },
      {
        type: 'module-domain',
        pattern: 'src/modules/*/domain/**',
        mode: 'full',
        capture: ['module'],
      },
      {
        type: 'module-application',
        pattern: 'src/modules/*/application/**',
        mode: 'full',
        capture: ['module'],
      },
      {
        type: 'module-infrastructure',
        pattern: 'src/modules/*/infrastructure/**',
        mode: 'full',
        capture: ['module'],
      },
      {
        type: 'module-root',
        pattern: 'src/modules/*/**',
        mode: 'full',
        capture: ['module'],
      },
      {
        type: 'platform',
        pattern: 'src/platform/*/**',
        mode: 'full',
        capture: ['port'],
      },
      { type: 'shared', pattern: 'src/shared/**', mode: 'full' },
      { type: 'app', pattern: 'src/**', mode: 'full' },
    ],
    // Los tests arman escenarios con piezas internas a propósito.
    'boundaries/ignore': ['test/**'],
  },
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    'prettier/prettier': 'error',
    '@typescript-eslint/no-unused-expressions': [
      'error',
      { allowTernary: true },
    ],
    // Qué puede importar cada capa. Lo que no está permitido acá, falla el lint:
    // - Un módulo sólo toca otro módulo por su `public/`.
    // - El dominio no conoce ni casos de uso ni infraestructura.
    // - `shared` y `platform` no dependen de ningún módulo de negocio.
    // - `app` (app.module, main) es la raíz de composición: ve todo.
    'boundaries/element-types': [
      'error',
      {
        default: 'disallow',
        message:
          '${file.type} no puede importar ${dependency.type} (ver spec Fase 1, 5.1)',
        rules: [
          {
            from: ['module-domain'],
            allow: [['module-domain', { module: '${from.module}' }], 'shared'],
          },
          {
            from: [
              'module-application',
              'module-infrastructure',
              'module-root',
            ],
            allow: [
              ['module-domain', { module: '${from.module}' }],
              ['module-application', { module: '${from.module}' }],
              ['module-infrastructure', { module: '${from.module}' }],
              ['module-root', { module: '${from.module}' }],
              ['module-public', { module: '${from.module}' }],
              'module-public',
              'platform',
              'shared',
            ],
          },
          {
            from: ['module-public'],
            allow: [
              ['module-domain', { module: '${from.module}' }],
              ['module-application', { module: '${from.module}' }],
              ['module-infrastructure', { module: '${from.module}' }],
              ['module-root', { module: '${from.module}' }],
              ['module-public', { module: '${from.module}' }],
              // Un contrato público puede declarar su cola (QueueDefinition).
              'platform',
              'shared',
            ],
          },
          {
            from: ['platform'],
            allow: [['platform', { port: '${from.port}' }], 'shared'],
          },
          { from: ['shared'], allow: ['shared'] },
          {
            from: ['app'],
            allow: [
              'app',
              'shared',
              'platform',
              'module-public',
              'module-root',
              'module-infrastructure',
              'module-application',
              'module-domain',
            ],
          },
        ],
      },
    ],
    '@typescript-eslint/no-unused-vars': [
      'warn',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],
  },
}
