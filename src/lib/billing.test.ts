import { describe, expect, test } from 'bun:test'
import {
  billOf,
  isUnusualConsumption,
  pricePerCubicMeter,
  splitEnergyBill,
} from './billing'

describe('splitEnergyBill', () => {
  test('divides the bill by each consumption', () => {
    // R$ 300,00 for 10 + 20 + 30 m³: R$ 5,00 per m³.
    const shares = splitEnergyBill(30_000, [
      { key: 1, consumption: 10 },
      { key: 2, consumption: 20 },
      { key: 3, consumption: 30 },
    ])
    expect([...shares]).toEqual([
      [1, 5000],
      [2, 10_000],
      [3, 15_000],
    ])
  })

  test('the shares always add up to the bill', () => {
    // R$ 100,00 for 3 equal consumptions: 33,33 + 33,33 + 33,34.
    const equal = splitEnergyBill(10_000, [
      { key: 1, consumption: 7 },
      { key: 2, consumption: 7 },
      { key: 3, consumption: 7 },
    ])
    expect([...equal.values()]).toEqual([3334, 3333, 3333])

    const items = [13, 29, 7, 101, 55].map((consumption, key) => ({
      key,
      consumption,
    }))
    const shares = splitEnergyBill(41_250, items)
    expect([...shares.values()].reduce((sum, share) => sum + share, 0)).toBe(
      41_250,
    )
  })

  test('the leftover centavos go to the largest remainders', () => {
    // R$ 10,00 for 1 + 2 m³: 3,333… and 6,666… → 3,33 and 6,67.
    const shares = splitEnergyBill(1000, [
      { key: 'a', consumption: 1 },
      { key: 'b', consumption: 2 },
    ])
    expect(shares.get('a')).toBe(333)
    expect(shares.get('b')).toBe(667)
  })

  test('nobody pays energy when no water was used', () => {
    const shares = splitEnergyBill(5000, [
      { key: 1, consumption: 0 },
      { key: 2, consumption: 0 },
    ])
    expect([...shares.values()]).toEqual([0, 0])
  })

  test('a chácara that used nothing pays no energy', () => {
    const shares = splitEnergyBill(5000, [
      { key: 1, consumption: 0 },
      { key: 2, consumption: 12 },
    ])
    expect(shares.get(1)).toBe(0)
    expect(shares.get(2)).toBe(5000)
  })

  test('works with huge meters without losing centavos', () => {
    const shares = splitEnergyBill(9_999_999, [
      { key: 1, consumption: 999_999_999 },
      { key: 2, consumption: 1 },
    ])
    expect((shares.get(1) ?? 0) + (shares.get(2) ?? 0)).toBe(9_999_999)
  })
})

describe('billOf', () => {
  test('adds the reserve fund to the energy share', () => {
    expect(
      billOf({
        previousReading: 366,
        currentReading: 461,
        energyCents: 3230,
        reserveFundCents: 1000,
      }),
    ).toEqual({
      consumption: 95,
      energyCents: 3230,
      reserveFundCents: 1000,
      totalCents: 4230,
    })
  })

  test('has no total until the electricity bill is known', () => {
    expect(
      billOf({
        previousReading: 10,
        currentReading: 25,
        energyCents: null,
        reserveFundCents: 1000,
      }),
    ).toEqual({
      consumption: 15,
      energyCents: null,
      reserveFundCents: 1000,
      totalCents: null,
    })
  })
})

describe('pricePerCubicMeter', () => {
  test('divides the bill by the m³ used', () => {
    // R$ 412,50 for 85 m³ = R$ 4,852941… per m³.
    expect(pricePerCubicMeter(41_250, 85)).toBe(4_852_941)
    expect(pricePerCubicMeter(41_250, 0)).toBeNull()
  })
})

describe('isUnusualConsumption', () => {
  test('flags readings far above the recent average', () => {
    expect(isUnusualConsumption(12_000_026, 25)).toBe(true)
    expect(isUnusualConsumption(180, 40)).toBe(true)
    expect(isUnusualConsumption(70, 40)).toBe(false)
    // Small houses can triple without it being an error.
    expect(isUnusualConsumption(45, 5)).toBe(false)
  })

  test('never flags the first reading of a chácara', () => {
    expect(isUnusualConsumption(5000, null)).toBe(false)
  })
})
