/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 *
 * Corre en el pre-commit (Husky) sobre los archivos staged. Los tests
 * relacionados van acá y no en el CI solamente: un commit en rojo no entra.
 */
module.exports = {
  '{src,test}/**/*.ts': [
    'prettier --write',
    'eslint --fix',
    'jest --bail --findRelatedTests --passWithNoTests',
  ],
  '*.{json,md,yml,yaml}': 'prettier --write',
}
