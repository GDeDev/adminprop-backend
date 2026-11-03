import { fillEmptyFields } from './fill-empty-fields'

describe('fillEmptyFields', () => {
  const current = { phone: null, email: 'a@b.com', address: '  ', notes: 'x' }

  it('completa sólo los campos vacíos que el archivo trae', () => {
    expect(
      fillEmptyFields(
        current,
        { phone: '11 1', email: 'otro@b.com', address: 'Calle 1', notes: null },
        ['phone', 'email', 'address', 'notes'],
      ),
    ).toEqual({ phone: '11 1', address: 'Calle 1' })
  })

  it('no inventa nada si el archivo no trae el dato', () => {
    expect(
      fillEmptyFields(current, { phone: '', address: null }, [
        'phone',
        'address',
      ]),
    ).toEqual({})
  })
})
