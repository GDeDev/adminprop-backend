import { buildDiff } from './audit.extension'

describe('buildDiff', () => {
  it('sólo incluye los campos que cambiaron', () => {
    const diff = buildDiff(
      { id: '1', nombre: 'Ana', precio: 100, ciudad: 'Rosario' },
      { id: '1', nombre: 'Ana', precio: 135, ciudad: 'Rosario' },
    )

    // El historial tiene que decir qué cambió, no repetir el registro entero.
    expect(Object.keys(diff)).toEqual(['precio'])
    expect(diff.precio).toEqual({ before: 100, after: 135 })
  })

  it('devuelve vacío si no cambió nada', () => {
    const estado = { id: '1', nombre: 'Ana' }

    expect(buildDiff(estado, { ...estado })).toEqual({})
  })

  it('ignora los campos de control', () => {
    // `updatedAt` cambia en cada update por definición: registrarlo llenaría el
    // historial de filas que no dicen nada.
    const diff = buildDiff(
      { id: '1', nombre: 'Ana', updatedAt: new Date('2026-01-01') },
      { id: '1', nombre: 'Ana', updatedAt: new Date('2026-06-01') },
    )

    expect(diff).toEqual({})
  })

  it('nunca incluye los campos excluidos', () => {
    // Guardar el "antes y después" de un hash de contraseña en una tabla de
    // auditoría sería filtrar material para crackear offline.
    const diff = buildDiff(
      { id: '1', passwordHash: '$2a$12$viejo', email: 'a@x.com' },
      { id: '1', passwordHash: '$2a$12$nuevo', email: 'b@x.com' },
      ['passwordHash'],
    )

    expect(diff.passwordHash).toBeUndefined()
    expect(diff.email).toEqual({ before: 'a@x.com', after: 'b@x.com' })
  })

  it('compara fechas por valor y no por referencia', () => {
    const misma = buildDiff(
      { lockedUntil: new Date('2026-01-01T10:00:00Z') },
      { lockedUntil: new Date('2026-01-01T10:00:00Z') },
    )
    expect(misma).toEqual({})

    const distinta = buildDiff(
      { lockedUntil: new Date('2026-01-01T10:00:00Z') },
      { lockedUntil: new Date('2026-01-02T10:00:00Z') },
    )
    expect(Object.keys(distinta)).toEqual(['lockedUntil'])
  })

  it('serializa las fechas a ISO para que entren en el JSON', () => {
    const diff = buildDiff(
      { deletedAt: null },
      { deletedAt: new Date('2026-06-01T12:00:00Z') },
    )

    expect(diff.deletedAt).toEqual({
      before: null,
      after: '2026-06-01T12:00:00.000Z',
    })
  })

  it('detecta el paso de null a un valor y al revés', () => {
    expect(buildDiff({ lastName: null }, { lastName: 'Gómez' })).toEqual({
      lastName: { before: null, after: 'Gómez' },
    })

    expect(buildDiff({ lastName: 'Gómez' }, { lastName: null })).toEqual({
      lastName: { before: 'Gómez', after: null },
    })
  })

  it('no rompe si falta alguno de los dos estados', () => {
    expect(buildDiff(null, { id: '1' })).toEqual({})
    expect(buildDiff({ id: '1' }, null)).toEqual({})
  })

  it('distingue false de null y de 0', () => {
    // Un `isActive: true -> false` es justo lo que querés ver en el historial.
    expect(buildDiff({ isActive: true }, { isActive: false })).toEqual({
      isActive: { before: true, after: false },
    })

    expect(buildDiff({ intentos: 0 }, { intentos: null })).toEqual({
      intentos: { before: 0, after: null },
    })
  })
})
