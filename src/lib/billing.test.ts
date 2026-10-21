import { describe, expect, test } from 'bun:test'
import {
  computeBill,
  isUnusualConsumption,
  priceFromElectricityBill,
} from './billing'

describe('computeBill', () => {
  test('matches the original Access app (Feb 2007)', () => {
    // 461 − 366 = 95 kWh × R$ 0,34 = R$ 32,30 + R$ 10,00 fund
    expect(
      computeBill({
        previousReading: 366,
        currentReading: 461,
        kwhPriceMicros: 340000,
        reserveFundCents: 1000,
      }),
    ).toEqual({
      consumption: 95,
      energyCents: 3230,
      reserveFundCents: 1000,
      totalCents: 4230,
    })
  })

  test('still charges the reserve fund when nothing was used', () => {
    const bill = computeBill({
      previousReading: 162,
      currentReading: 162,
      kwhPriceMicros: 350000,
      reserveFundCents: 1000,
    })
    expect(bill.energyCents).toBe(0)
    expect(bill.totalCents).toBe(1000)
  })

  test('rounds the energy cost half up to the centavo', () => {
    // 1 kWh × R$ 0,8745 = R$ 0,8745 → R$ 0,87; 3 kWh → 2,6235 → 2,62
    const base = { previousReading: 0, reserveFundCents: 0 }
    expect(
      computeBill({ ...base, currentReading: 1, kwhPriceMicros: 874500 })
        .energyCents,
    ).toBe(87)
    // 1 kWh × R$ 0,875 = 87,5 centavos → 88
    expect(
      computeBill({ ...base, currentReading: 1, kwhPriceMicros: 875000 })
        .energyCents,
    ).toBe(88)
    expect(
      computeBill({ ...base, currentReading: 3, kwhPriceMicros: 874500 })
        .energyCents,
    ).toBe(262)
  })
})

describe('priceFromElectricityBill', () => {
  test('divides the bill total by the kWh on the bill', () => {
    // R$ 412,50 for 480 kWh = R$ 0,859375 → 0,8594
    expect(priceFromElectricityBill(41250, 480)).toBe(859400)
  })

  test('returns null when the bill is incomplete', () => {
    expect(priceFromElectricityBill(41250, 0)).toBeNull()
    expect(priceFromElectricityBill(0, 100)).toBeNull()
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
