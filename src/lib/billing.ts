export interface BillInput {
  previousReading: number
  currentReading: number
  kwhPriceMicros: number
  reserveFundCents: number
}

export interface Bill {
  /** kWh used in the month. */
  consumption: number
  /** Consumption × kWh price, in centavos. */
  energyCents: number
  reserveFundCents: number
  /** Energy cost + reserve fund, in centavos. */
  totalCents: number
}

/**
 * The rules from the original spreadsheet:
 *   Consumo       = Leitura Atual − Leitura Anterior
 *   Custo Energia = Consumo × Preço do kWh (rounded to the centavo)
 *   Total         = Custo Energia + Fundo Reserva
 */
export function computeBill(input: BillInput): Bill {
  const consumption = input.currentReading - input.previousReading
  // Integer math with half-up rounding: kWh × micros → centavos.
  const energyCents = Math.floor(
    (Math.max(consumption, 0) * input.kwhPriceMicros + 5_000) / 10_000,
  )
  return {
    consumption,
    energyCents,
    reserveFundCents: input.reserveFundCents,
    totalCents: energyCents + input.reserveFundCents,
  }
}

/**
 * Suggests a kWh price from the electricity bill of the pump:
 * total of the bill ÷ kWh on the bill, in micros (4 decimal places).
 */
export function priceFromElectricityBill(
  billTotalCents: number,
  billKwh: number,
): number | null {
  if (billKwh <= 0 || billTotalCents <= 0) return null
  // centavos → micros is ×10_000; keep 4 decimals (multiples of 100 micros).
  const micros = (billTotalCents * 10_000) / billKwh
  return Math.round(micros / 100) * 100
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
