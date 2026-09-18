import type { Config } from 'jest'

const config: Config = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  // Los tests unitarios viven al lado del código que prueban (`*.spec.ts`).
  // Los e2e van en `test/` y usan `test/jest-e2e.json`.
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.(t|j)s$': 'ts-jest',
  },
  collectCoverageFrom: [
    '**/*.(t|j)s',
    '!**/*.module.ts',
    '!**/*.dto.ts',
    '!**/index.ts',
    '!main.ts',
  ],
  coverageDirectory: '../coverage',

  // Umbral bajo a propósito: es un piso para que la cobertura no caiga sin que
  // nadie se entere, no una meta. Subilo a medida que crezca el dominio; poner
  // un número alto de entrada sólo lleva a escribir tests de relleno.
  coverageThreshold: {
    global: {
      statements: 28,
      branches: 20,
      functions: 20,
      lines: 28,
    },
  },

  testEnvironment: 'node',

  verbose: true,
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/../test/setup.ts'],
}

export default config
