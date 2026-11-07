import { PrismaClient } from '@prisma/client'

import {
  duplicatesSql,
  findUniqueDuplicates,
  UNIQUE_CHECKS,
} from '../../src/shared/prisma/constraints/unique-duplicates'

const USAGE = `
Chequea si hay filas repetidas que impedirían crear los índices únicos de la
migración 20261110120000_add_missing_unique_constraints. Solo lee.

  npm run db:check-duplicates            corre los chequeos contra DATABASE_URL
  npm run db:check-duplicates -- --sql   imprime las consultas (para psql)

Sale con código 1 si hay duplicados: hay que limpiarlos antes de migrar.
`

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--help')) {
    console.log(USAGE)
    return
  }
  if (args.includes('--sql')) {
    for (const check of UNIQUE_CHECKS) {
      console.log(`-- ${check.index}\n${duplicatesSql(check)};\n`)
    }
    return
  }

  const prisma = new PrismaClient()
  try {
    const found = await findUniqueDuplicates(prisma)
    if (found.length === 0) {
      console.log('Sin duplicados: los índices únicos se pueden crear.')
      return
    }
    for (const { check, groups } of found) {
      console.error(`\n${check.table} (${check.columns.join(', ')}):`)
      console.error(JSON.stringify(groups, null, 2))
    }
    process.exitCode = 1
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
