#!/usr/bin/env node
/**
 * Corre un comando con NODE_ENV por defecto, sin pisar el que ya venga del
 * entorno (Doppler). La app exige NODE_ENV explícito (D-251) y la sintaxis
 * `NODE_ENV=x cmd` no anda en Windows; esto evita sumar cross-env.
 *
 *   node scripts/with-node-env.cjs development nest start --watch
 */
const { spawn } = require('node:child_process')

const [fallback, command, ...args] = process.argv.slice(2)
if (!fallback || !command) {
  console.error(
    'Uso: node scripts/with-node-env.cjs <entorno> <comando> [args...]',
  )
  process.exit(2)
}

const env = { ...process.env }
if (!env.NODE_ENV || env.NODE_ENV.trim() === '') env.NODE_ENV = fallback

const child = spawn(command, args, { stdio: 'inherit', shell: true, env })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
