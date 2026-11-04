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
    '!**/testing/**',
  ],
  coverageDirectory: '../coverage',

  // Un piso para que la cobertura no caiga sin que nadie se entere, no una
  // meta. Está apenas por debajo de lo medido con los unitarios solos
  // (47,96 / 35,35 / 32,49 / 47,43); subilo cuando el número real suba, y no
  // antes: poner uno alto de entrada sólo lleva a escribir tests de relleno.
  coverageThreshold: {
    global: {
      statements: 47,
      branches: 35,
      functions: 32,
      lines: 47,
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
