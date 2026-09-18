import { plainToInstance } from 'class-transformer'
import { validateSync } from 'class-validator'

import { IsMoneyAmount } from './is-money-amount.decorator'

class AmountDto {
  @IsMoneyAmount()
  amount!: unknown
}

class SignedAmountDto {
  @IsMoneyAmount({ allowNegative: true })
  amount!: unknown
}

function errorsFor(dto: new () => object, amount: unknown) {
  return validateSync(plainToInstance(dto, { amount }))
}

describe('IsMoneyAmount', () => {
  it.each(['0', '150333.33', '10.5', '999999999999.99'])(
    'acepta "%s"',
    (amount) => {
      expect(errorsFor(AmountDto, amount)).toHaveLength(0)
    },
  )

  it.each([
    ['un number', 150.5],
    ['coma decimal', '150,50'],
    ['tres decimales', '1.005'],
    ['separador de miles', '1.500.000'],
    ['13 dígitos enteros', '1000000000000'],
    ['texto', 'abc'],
    ['negativo sin permitirlo', '-10'],
  ])('rechaza %s', (_, amount) => {
    expect(errorsFor(AmountDto, amount)).not.toHaveLength(0)
  })

  it('acepta negativos si se lo pide', () => {
    expect(errorsFor(SignedAmountDto, '-10.25')).toHaveLength(0)
  })
})
