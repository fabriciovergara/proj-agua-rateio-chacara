/*
 * The rateio: each period, the electricity bill of the shared water pump is
 * divided among the chácaras read in it, in proportion to the water (m³)
 * each one used, and every chácara also pays the reserve fund.
 *
 *   Consumo  = Leitura atual − Última leitura (m³)
 *   Energia  = Conta de energia × Consumo ÷ Consumo de todas as chácaras
 *   Total    = Energia + Fundo de reserva
 */

export interface MeterValues {
  previousReading: number
  currentReading: number
}

/** m³ of water used between two readings. */
export function consumptionOf(reading: MeterValues): number {
  return Math.max(reading.currentReading - reading.previousReading, 0)
}

export interface Bill {
  /** m³ of water used in the period. */
  consumption: number
  /** Share of the pump's electricity bill, in centavos; null until it is known. */
  energyCents: number | null
  reserveFundCents: number
  /** Energy share + reserve fund, in centavos; null until the bill is known. */
  totalCents: number | null
}

/** What a reading charges, from the values stored with it. */
export function billOf(
  reading: MeterValues & {
    energyCents: number | null
    reserveFundCents: number
  },
): Bill {
  return {
    consumption: consumptionOf(reading),
    energyCents: reading.energyCents,
    reserveFundCents: reading.reserveFundCents,
    totalCents:
      reading.energyCents === null
        ? null
        : reading.energyCents + reading.reserveFundCents,
  }
}

/**
 * Divides the electricity bill in proportion to each consumption, in whole
 * centavos that add up to the bill exactly: everyone gets their share
 * rounded down, and the centavos left over go one by one to the largest
 * remainders (ties: the larger consumption, then the smaller key). When no
 * water was used at all, nobody is charged for energy.
 */
export function splitEnergyBill<K extends number | string>(
  billCents: number,
  items: ReadonlyArray<{ key: K; consumption: number }>,
): Map<K, number> {
  const shares = new Map<K, number>()
  const total = items.reduce(
    (sum, item) => sum + Math.max(item.consumption, 0),
    0,
  )
  if (total === 0 || billCents <= 0) {
    for (const item of items) shares.set(item.key, 0)
    return shares
  }

  // BigInt: bill × consumption can pass 2^53 for big meters.
  const bill = BigInt(billCents)
  const divisor = BigInt(total)
  let left = billCents
  const remainders = items.map((item) => {
    const scaled = bill * BigInt(Math.max(item.consumption, 0))
    const share = Number(scaled / divisor)
    shares.set(item.key, share)
    left -= share
    return { ...item, remainder: scaled % divisor }
  })
  remainders.sort(
    (a, b) =>
      (a.remainder === b.remainder ? 0 : a.remainder > b.remainder ? -1 : 1) ||
      b.consumption - a.consumption ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
  )
  for (const item of remainders.slice(0, left)) {
    shares.set(item.key, (shares.get(item.key) ?? 0) + 1)
  }
  return shares
}

/**
 * What each m³ of water cost in the period (bill ÷ m³), in micros (millionths
 * of a real), just to show how the split came out.
 */
export function pricePerCubicMeter(
  billCents: number,
  consumption: number,
): number | null {
  if (consumption <= 0) return null
  return Math.round((billCents * 10_000) / consumption)
}

/**
 * A reading far above the chácara's recent average is probably a typo (an
 * extra digit, a swapped meter). The screen asks for confirmation before
 * saving it.
 */
export function isUnusualConsumption(
  consumption: number,
  recentAverage: number | null,
): boolean {
  if (recentAverage === null) return false
  return consumption > Math.max(recentAverage * 3, recentAverage + 50)
}
