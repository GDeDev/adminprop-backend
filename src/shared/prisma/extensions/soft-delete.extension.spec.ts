import { behaviourFor, delegateKey, DELETED_MARKER } from './auditable-models'
import { markDeletedValue, unmarkDeletedValue } from './soft-delete.extension'

describe('marcado de valores únicos', () => {
  it('marca el valor con el id del registro', () => {
    // Un unique compuesto (email, deletedAt) no sirve: los índices
    // únicos tratan cada NULL como distinto, así que dos usuarios activos
    // pasarían el constraint. Por eso se muta el valor al borrar.
    const marcado = markDeletedValue('ana@ejemplo.com', 'user-1')

    expect(marcado).toBe(`ana@ejemplo.com${DELETED_MARKER}user-1`)
  })

  it('libera el email para que se pueda volver a registrar', () => {
    const a = markDeletedValue('ana@ejemplo.com', 'user-1')
    const b = markDeletedValue('ana@ejemplo.com', 'user-2')

    // Dos bajas del mismo email no colisionan entre sí ni con un alta nueva.
    expect(a).not.toBe(b)
    expect(a).not.toBe('ana@ejemplo.com')
  })

  it('recupera el valor original', () => {
    expect(unmarkDeletedValue(markDeletedValue('ana@ejemplo.com', 'u1'))).toBe(
      'ana@ejemplo.com',
    )
  })

  it('deja intacto un valor sin marcar', () => {
    expect(unmarkDeletedValue('ana@ejemplo.com')).toBe('ana@ejemplo.com')
  })
})

describe('behaviourFor', () => {
  it('User se audita y se borra lógicamente', () => {
    const behaviour = behaviourFor('User')

    expect(behaviour.audit).toBe(true)
    expect(behaviour.softDelete).toBe(true)
    expect(behaviour.mutateOnDelete).toContain('email')
  })

  it('nunca audita el hash de contraseña', () => {
    expect(behaviourFor('User').excludeFromDiff).toContain('passwordHash')
  })

  it('los refresh tokens no se auditan', () => {
    // Se rotan en cada refresh: auditarlos generaría una fila por request.
    expect(behaviourFor('RefreshToken').audit).toBe(false)
  })

  it('la tabla de auditoría no se audita a sí misma', () => {
    // Sería recursión infinita.
    expect(behaviourFor('AuditLog').audit).toBe(false)
  })

  it('un modelo no declarado no tiene ningún comportamiento', () => {
    // Opt-in: sumar una tabla nueva no la mete en el historial por accidente.
    const behaviour = behaviourFor('ModeloNuevo')

    expect(behaviour.audit).toBe(false)
    expect(behaviour.softDelete).toBe(false)
  })

  it('no rompe con un modelo undefined', () => {
    expect(() => behaviourFor(undefined)).not.toThrow()
  })
})

describe('delegateKey', () => {
  it('convierte el nombre del modelo al del delegate', () => {
    // Las extensiones reciben 'User' pero el cliente expone 'prisma.user'.
    // Acceder con el nombre sin convertir devuelve undefined, y el error recién
    // aparece una llamada después como "Cannot read properties of undefined".
    // Este bug hizo fallar todos los login contra la base real.
    expect(delegateKey('User')).toBe('user')
    expect(delegateKey('AuditLog')).toBe('auditLog')
    expect(delegateKey('RefreshToken')).toBe('refreshToken')
  })

  it('deja igual un nombre que ya viene en camelCase', () => {
    expect(delegateKey('user')).toBe('user')
  })

  it('cubre todos los modelos configurados', () => {
    // Si alguien agrega un modelo a MODEL_BEHAVIOUR, su delegate tiene que
    // resolverse a algo distinto del nombre del modelo.
    for (const model of ['User', 'RefreshToken', 'AuditLog']) {
      expect(delegateKey(model)).not.toBe(model)
      expect(delegateKey(model)[0]).toBe(model[0].toLowerCase())
    }
  })
})
