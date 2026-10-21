import { Calculator } from 'lucide-react'
import { useState } from 'react'
import { FormField, MoneyInput, TextField } from '#/components/form'
import { Button } from '#/components/ui/button'
import { priceFromElectricityBill } from '#/lib/billing'
import { formatKwhPrice, parseCents } from '#/lib/money'

/** Price per kWh = total of the electricity bill ÷ kWh on that bill. */
export function PriceCalculator({
  onUse,
}: {
  onUse: (micros: number) => void
}) {
  const [total, setTotal] = useState('')
  const [kwh, setKwh] = useState('')
  const totalCents = parseCents(total)
  const kwhValue = Number(kwh.replace(/\D/g, ''))
  const micros =
    totalCents !== null && kwhValue > 0
      ? priceFromElectricityBill(totalCents, kwhValue)
      : null

  return (
    <details className="rounded-lg border bg-muted/50 px-4 py-3">
      <summary className="flex cursor-pointer items-center gap-2 font-semibold text-primary">
        <Calculator aria-hidden="true" className="size-5" />
        Calcular o preço do kWh pela conta de luz da bomba
      </summary>
      <div className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <FormField label="Valor total da conta (R$)">
          {(props) => (
            <MoneyInput
              {...props}
              className="bg-background"
              value={total}
              onChange={setTotal}
            />
          )}
        </FormField>
        <TextField
          label="Consumo da conta (kWh)"
          inputMode="numeric"
          className="[&_input]:bg-background"
          value={kwh}
          onChange={(value) => setKwh(value.replace(/\D/g, ''))}
        />
        <Button
          variant="outline"
          disabled={micros === null}
          onClick={() => micros !== null && onUse(micros)}
        >
          Usar {micros !== null ? formatKwhPrice(micros) : 'este preço'}
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {micros !== null
          ? `Cada kWh custou ${formatKwhPrice(micros)} nesta conta.`
          : 'Os dois números estão impressos na conta de energia.'}
      </p>
    </details>
  )
}
