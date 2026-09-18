/**
 * @filename: lint-staged.config.js
 * @type {import('lint-staged').Configuration}
 */
module.exports = {
  '{src,apps,libs,test}/**/*.ts': 'eslint --fix',
}
