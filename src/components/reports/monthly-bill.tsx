import { CircleCheck, MessageCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { PropertyPlate } from '#/components/property-plate'
import { Button } from '#/components/ui/button'
import { Card } from '#/components/ui/card'
import { ACCOUNT_TYPE_LABELS, PIX_KEY_TYPE_LABELS } from '#/lib/domain'
import { whatsappLink } from '#/lib/masks'
import { formatBRL, formatKwhPrice, formatNumber } from '#/lib/money'
import { formatDate, formatPeriod } from '#/lib/periods'
import type { MonthlyBills } from '#/server/reports.server'
import { PixPayment } from './pix-payment'

type Bill = MonthlyBills['bills'][number]

export function formatAddress(property: {
  street: string | null
  number: string | null
  district: string | null
  city: string | null
  state: string | null
  zipCode: string | null
}): string[] {
  return [
    [property.street, property.number].filter(Boolean).join(', '),
    property.district,
    [
      [property.city, property.state].filter(Boolean).join('/'),
      property.zipCode ? `CEP ${property.zipCode}` : null,
    ]
      .filter(Boolean)
      .join(' — '),
  ].filter((line): line is string => Boolean(line))
}

/** The message sent to the owner, with everything needed to pay. */
function whatsappMessage(report: MonthlyBills, bill: Bill): string {
  const { reading, property, owner, pixPayload } = bill
  const lines = [
    `Olá${owner ? `, ${owner.name}` : ''}! Segue a cobrança da energia da bomba d’água de ${formatPeriod(report.period)} — ${property.name}.`,
    '',
    `Leitura: ${formatNumber(reading.previousReading)} → ${formatNumber(reading.currentReading)} (${formatNumber(reading.bill.consumption)} kWh)`,
    `Energia: ${formatBRL(reading.bill.energyCents)}`,
    `Fundo de reserva: ${formatBRL(reading.bill.reserveFundCents)}`,
    `*Total: ${formatBRL(reading.bill.totalCents)}*`,
  ]
  if (report.dueDate) lines.push(`Vencimento: ${formatDate(report.dueDate)}`)
  if (report.bank?.pixKey && report.bank.pixKeyType) {
    lines.push(
      '',
      `Pix (${PIX_KEY_TYPE_LABELS[report.bank.pixKeyType]}): ${report.bank.pixKey}`,
    )
  }
  if (pixPayload) lines.push('', 'Pix copia e cola:', pixPayload)
  return lines.join('\n')
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="mb-1 text-sm font-semibold text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  )
}

function Line({
  label,
  value,
  strong,
}: {
  label: ReactNode
  value: ReactNode
  strong?: boolean
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-6 border-b border-dotted py-1.5 last:border-b-0 ${
        strong ? 'text-[1.35rem] font-bold' : ''
      }`}
    >
      <dt>{label}</dt>
      <dd className="text-right whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  )
}

/** One printable bill ("Relatório mensal"). */
export function MonthlyBill({
  report,
  bill,
}: {
  report: MonthlyBills
  bill: Bill
}) {
  const { reading, property, owner, pixPayload } = bill
  const { bank } = report

  return (
    <Card className="print-page mx-auto w-full max-w-[52rem] gap-7 px-6 py-6 shadow-md sm:px-10 sm:py-10 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none">
      <header className="flex items-start justify-between gap-6 border-b-2 border-foreground pb-5">
        <div>
          {report.groupName && (
            <p className="font-semibold text-muted-foreground">
              {report.groupName}
            </p>
          )}
          <h2 className="text-[1.6rem] leading-tight font-bold">
            Cobrança de energia da bomba d’água
          </h2>
          <p className="text-[1.15rem]">{formatPeriod(report.period)}</p>
        </div>
        <PropertyPlate name={property.name} size="lg" />
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title="Proprietário">
          <p className="text-[1.15rem] font-bold">
            {owner?.name ?? 'Sem proprietário cadastrado'}
          </p>
          {owner?.document && (
            <p className="tabular-nums">Documento {owner.document}</p>
          )}
          {owner?.phone && <p className="tabular-nums">{owner.phone}</p>}
          {owner?.email && <p>{owner.email}</p>}
        </Block>
        <Block title="Chácara">
          <p className="text-[1.15rem] font-bold">{property.name}</p>
          {formatAddress(property).map((line) => (
            <p key={line}>{line}</p>
          ))}
          {property.meterNumber && (
            <p className="tabular-nums">Hidrômetro {property.meterNumber}</p>
          )}
        </Block>
      </div>

      <div className="grid gap-6 sm:grid-cols-2">
        <Block title="Leitura do hidrômetro">
          <dl>
            <Line
              label={
                reading.readingDate
                  ? `Leitura atual (${formatDate(reading.readingDate)})`
                  : 'Leitura atual'
              }
              value={formatNumber(reading.currentReading)}
            />
            <Line
              label="Leitura anterior"
              value={formatNumber(reading.previousReading)}
            />
            <Line
              label="Consumo"
              value={`${formatNumber(reading.bill.consumption)} kWh`}
            />
          </dl>
        </Block>
        <Block title="Cálculo">
          <dl>
            <Line
              label={`Energia: ${formatNumber(reading.bill.consumption)} kWh × ${formatKwhPrice(reading.kwhPriceMicros)}`}
              value={formatBRL(reading.bill.energyCents)}
            />
            <Line
              label="Fundo de reserva"
              value={formatBRL(reading.bill.reserveFundCents)}
            />
            <Line
              label="Total a pagar"
              value={formatBRL(reading.bill.totalCents)}
              strong
            />
          </dl>
          {report.dueDate && !reading.paid && (
            <p className="mt-1 font-semibold">
              Vencimento: {formatDate(report.dueDate)}
            </p>
          )}
        </Block>
      </div>

      {reading.paid ? (
        <div className="flex items-center gap-3 rounded-lg border-2 border-paid bg-paid-soft px-5 py-4 text-paid">
          <CircleCheck aria-hidden="true" className="size-7" />
          <p className="text-[1.2rem] font-bold">
            Pago{reading.paidAt ? ` em ${formatDate(reading.paidAt)}` : ''}.
            Obrigado!
          </p>
        </div>
      ) : (
        <section className="grid gap-6 border-t pt-6 sm:grid-cols-[1fr_auto]">
          <Block title="Como pagar">
            {bank?.pixKey && bank.pixKeyType && (
              <p className="text-[1.1rem]">
                <strong>Pix</strong> ({PIX_KEY_TYPE_LABELS[bank.pixKeyType]}):{' '}
                <span className="font-semibold break-all">{bank.pixKey}</span>
              </p>
            )}
            {bank?.bankName && (
              <p>
                {bank.bankName}
                {bank.bankCode && ` (${bank.bankCode})`}
              </p>
            )}
            {(bank?.branch || bank?.accountNumber) && (
              <p className="tabular-nums">
                {bank.branch && `Agência ${bank.branch}`}
                {bank.branch && bank.accountNumber && ' — '}
                {bank.accountNumber &&
                  `Conta ${bank.accountType ? `${ACCOUNT_TYPE_LABELS[bank.accountType].toLowerCase()} ` : ''}${bank.accountNumber}`}
              </p>
            )}
            {bank?.holderName && <p>Favorecido: {bank.holderName}</p>}
            {!bank && (
              <p className="text-pending">
                Os dados bancários ainda não foram cadastrados em Configurações.
              </p>
            )}
          </Block>
          {pixPayload ? (
            <PixPayment payload={pixPayload} />
          ) : (
            report.pixMissing && (
              <p className="max-w-[16rem] text-sm text-muted-foreground print:hidden">
                Para mostrar o QR Code Pix, preencha a chave Pix, o nome e a
                cidade do favorecido em Configurações.
              </p>
            )
          )}
        </section>
      )}

      {!reading.paid && (
        <div className="flex flex-wrap gap-3 border-t pt-5 print:hidden">
          <Button variant="outline" asChild>
            <a
              href={whatsappLink(
                owner?.phone ?? null,
                whatsappMessage(report, bill),
              )}
              target="_blank"
              rel="noreferrer"
            >
              <MessageCircle aria-hidden="true" />
              Enviar pelo WhatsApp
            </a>
          </Button>
        </div>
      )}
    </Card>
  )
}
