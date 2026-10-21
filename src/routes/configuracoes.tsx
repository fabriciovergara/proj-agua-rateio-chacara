import { createFileRoute, Link } from '@tanstack/react-router'
import {
  CircleCheck,
  Download,
  KeyRound,
  LogOut,
  Trash2,
  Upload,
} from 'lucide-react'
import { type FormEvent, useId, useState } from 'react'
import { toast } from 'sonner'
import { ConfirmDialog } from '#/components/confirm-dialog'
import { SelectField, TextField } from '#/components/form'
import { Notice, PageHeader } from '#/components/page'
import { PixPayment } from '#/components/reports/pix-payment'
import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '#/components/ui/alert-dialog'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { FieldGroup } from '#/components/ui/field'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import {
  ACCOUNT_TYPE_LABELS,
  ACCOUNT_TYPES,
  MIN_PASSWORD_LENGTH,
  PIX_KEY_TYPE_LABELS,
  PIX_KEY_TYPES,
} from '#/lib/domain'
import { formatPhone } from '#/lib/masks'
import { tryBuildPixPayload } from '#/lib/pix'
import {
  type BankAccountInput,
  bankAccountSchema,
  fieldErrors,
} from '#/lib/schemas'
import { useAction } from '#/lib/use-action'
import { importLegacyZip } from '#/server/legacy.functions'
import {
  clearBankAccount,
  getSettings,
  removeAppPassword,
  saveBankAccount,
  saveSettings,
  setAppPassword,
} from '#/server/settings.functions'

export const Route = createFileRoute('/configuracoes')({
  loader: () => getSettings(),
  head: () => ({ meta: [{ title: 'Configurações — Rateio da Água' }] }),
  component: SettingsPage,
})

type Settings = Awaited<ReturnType<typeof getSettings>>

const dangerOutline =
  'border-destructive/50 text-destructive hover:bg-destructive/10 hover:text-destructive'

function SettingsPage() {
  const settings = Route.useLoaderData()
  // Remount the forms when the saved values change (e.g. after "Apagar").
  const settingsKey = `cobrancas-${settings.settings?.updatedAt?.getTime()}`
  const bankKey = `banco-${settings.bank?.updatedAt?.getTime()}`
  const lockKey = `senha-${settings.lock.envPassword}-${settings.lock.appPassword}`

  return (
    <div className="flex max-w-4xl flex-col gap-10">
      <PageHeader
        title="Configurações"
        description="O que aparece nas cobranças, a conta onde os proprietários pagam e a senha do app."
        className="mb-0"
      />
      <BillingSection key={settingsKey} settings={settings.settings} />
      <BankSection key={bankKey} bank={settings.bank} />
      <PasswordSection key={lockKey} lock={settings.lock} />
      <BackupSection />
      <LegacyImportSection />
    </div>
  )
}

function BillingSection({ settings }: { settings: Settings['settings'] }) {
  const [values, setValues] = useState({
    groupName: settings?.groupName ?? '',
    dueDay: settings?.dueDay ? String(settings.dueDay) : '',
  })
  const save = useAction(saveSettings, {
    success: 'Dados das cobranças salvos.',
  })

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    await save.run({
      data: {
        groupName: values.groupName,
        dueDay: values.dueDay ? Number(values.dueDay) : null,
      },
    })
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-2xl">Cobranças</CardTitle>
          <CardDescription className="text-base">
            O que aparece em todas as cobranças. O preço do kWh e o fundo de
            reserva de cada mês ficam na tela{' '}
            <Link to="/" className="font-semibold text-primary underline">
              Leituras
            </Link>
            .
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            <TextField
              label="Nome do grupo"
              description="Aparece no topo das cobranças, como “Associação das Chácaras”."
              value={values.groupName}
              onChange={set('groupName')}
            />
            <SelectField
              label="Dia do vencimento"
              description="As cobranças vencem neste dia do mês seguinte à leitura."
              value={values.dueDay}
              onChange={set('dueDay')}
              placeholder="Sem vencimento"
              options={Array.from({ length: 31 }, (_, index) => ({
                value: String(index + 1),
                label: `Dia ${index + 1}`,
              }))}
            />
          </FieldGroup>
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={save.pending}>
            {save.pending ? 'Salvando…' : 'Salvar'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

function BankSection({ bank }: { bank: Settings['bank'] }) {
  const [values, setValues] = useState({
    bankName: bank?.bankName ?? '',
    bankCode: bank?.bankCode ?? '',
    branch: bank?.branch ?? '',
    accountNumber: bank?.accountNumber ?? '',
    accountType: bank?.accountType ?? '',
    pixKeyType: bank?.pixKeyType ?? '',
    pixKey: bank?.pixKey ?? '',
    holderName: bank?.holderName ?? '',
    holderCity: bank?.holderCity ?? '',
  })
  const [errors, setErrors] = useState<Record<string, string>>({})
  const save = useAction(saveBankAccount, {
    success: 'Dados bancários salvos.',
  })
  const clear = useAction(clearBankAccount, {
    success: 'Dados bancários apagados.',
  })

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const input = values as BankAccountInput
    const parsed = bankAccountSchema.safeParse(input)
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error))
      toast.error('Confira os campos destacados.')
      return
    }
    setErrors({})
    await save.run({ data: input })
  }

  const testPayload =
    bank?.pixKey && bank.pixKeyType && bank.holderName && bank.holderCity
      ? tryBuildPixPayload({
          key: bank.pixKey,
          keyType: bank.pixKeyType,
          name: bank.holderName,
          city: bank.holderCity,
        })
      : null

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-2xl">Dados Bancários</CardTitle>
          <CardDescription className="text-base">
            Aparecem em todas as cobranças, com o QR Code Pix já com o valor de
            cada uma.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <FieldGroup className="grid gap-6 md:grid-cols-6">
            <TextField
              label="Nome do Banco"
              error={errors.bankName}
              value={values.bankName}
              onChange={set('bankName')}
              className="md:col-span-4"
            />
            <TextField
              label="Número do Banco"
              description="Por exemplo 001."
              error={errors.bankCode}
              value={values.bankCode}
              onChange={set('bankCode')}
              inputMode="numeric"
              className="md:col-span-2"
            />
            <TextField
              label="Número da Agência"
              error={errors.branch}
              value={values.branch}
              onChange={set('branch')}
              className="md:col-span-2"
            />
            <TextField
              label="Número da Conta"
              error={errors.accountNumber}
              value={values.accountNumber}
              onChange={set('accountNumber')}
              className="md:col-span-2"
            />
            <SelectField
              label="Tipo da conta"
              error={errors.accountType}
              value={values.accountType}
              onChange={set('accountType')}
              placeholder="Escolha"
              options={ACCOUNT_TYPES.map((type) => ({
                value: type,
                label: ACCOUNT_TYPE_LABELS[type],
              }))}
              className="md:col-span-2"
            />
            <SelectField
              label="Tipo da chave Pix"
              error={errors.pixKeyType}
              value={values.pixKeyType}
              onChange={set('pixKeyType')}
              placeholder="Escolha"
              options={PIX_KEY_TYPES.map((type) => ({
                value: type,
                label: PIX_KEY_TYPE_LABELS[type],
              }))}
              className="md:col-span-2"
            />
            <TextField
              label="Chave PIX"
              error={errors.pixKey}
              value={values.pixKey}
              onChange={(value) =>
                set('pixKey')(
                  values.pixKeyType === 'telefone' ? formatPhone(value) : value,
                )
              }
              className="md:col-span-4"
            />
            <TextField
              label="Nome do favorecido"
              description="Titular da conta. O Pix exige nome e cidade para gerar o QR Code."
              error={errors.holderName}
              value={values.holderName}
              onChange={set('holderName')}
              className="md:col-span-4"
            />
            <TextField
              label="Cidade do favorecido"
              error={errors.holderCity}
              value={values.holderCity}
              onChange={set('holderCity')}
              className="md:col-span-2"
            />
          </FieldGroup>

          {testPayload && (
            <>
              <Separator />
              <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div>
                  <h3 className="text-lg font-bold">Conferir o Pix</h3>
                  <p className="mt-1 max-w-[46ch] text-muted-foreground">
                    Aponte o aplicativo do banco para este código de teste, sem
                    valor. Ele deve mostrar{' '}
                    <strong className="text-foreground">
                      {bank?.holderName}
                    </strong>{' '}
                    como favorecido. Não é preciso pagar.
                  </p>
                </div>
                <PixPayment payload={testPayload} />
              </div>
            </>
          )}
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" size="lg" disabled={save.pending}>
            {save.pending ? 'Salvando…' : 'Salvar dados bancários'}
          </Button>
          {bank && (
            <ConfirmDialog
              title="Apagar os dados bancários?"
              description={
                <p>
                  As cobranças deixam de mostrar a conta e o QR Code Pix até que
                  novos dados sejam salvos.
                </p>
              }
              confirmLabel="Apagar dados"
              onConfirm={() => clear.run()}
              trigger={
                <Button
                  variant="outline"
                  className={dangerOutline}
                  disabled={clear.pending}
                >
                  <Trash2 aria-hidden="true" />
                  Apagar dados bancários
                </Button>
              }
            />
          )}
        </CardFooter>
      </form>
    </Card>
  )
}

const passwordText = (show: boolean) => (show ? 'text' : 'password')

function PasswordSection({ lock }: { lock: Settings['lock'] }) {
  const empty = { current: '', password: '', repeat: '' }
  const [values, setValues] = useState(empty)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [showPasswords, setShowPasswords] = useState(false)
  const showId = useId()
  const save = useAction(setAppPassword, {
    success: lock.appPassword
      ? 'Senha trocada. Os outros aparelhos vão pedir a senha de novo.'
      : 'Senha criada. Os outros aparelhos vão pedir a senha para entrar.',
    // With a password, what fails is the current one: say it next to it.
    onError: lock.locked
      ? (message) => setErrors({ current: message })
      : undefined,
  })

  const set = (key: keyof typeof values) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }))

  async function submit(event: FormEvent) {
    event.preventDefault()
    const found: Record<string, string> = {}
    if (lock.locked && !values.current) {
      found.current = 'Digite a senha que você usa para entrar.'
    }
    if (values.password.length < MIN_PASSWORD_LENGTH) {
      found.password = `Use pelo menos ${MIN_PASSWORD_LENGTH} letras ou números.`
    } else if (values.repeat !== values.password) {
      found.repeat = 'As duas senhas estão diferentes. Digite de novo.'
    }
    setErrors(found)
    if (Object.keys(found).length > 0) return
    const result = await save.run({
      data: { current: values.current, password: values.password },
    })
    if (result) setValues(empty)
  }

  return (
    <Card>
      <form onSubmit={submit} noValidate className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-2xl">Senha de acesso</CardTitle>
          <CardDescription className="text-base">
            Com senha, o app só mostra os dados depois que ela é digitada. Cada
            aparelho pede a senha uma vez e depois lembra dela por 60 dias.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <LockStatus lock={lock} />
          <FieldGroup className="grid gap-6 md:grid-cols-2">
            {lock.locked && (
              <TextField
                label="Senha atual"
                description="A senha que você usa para entrar no app."
                error={errors.current}
                value={values.current}
                onChange={set('current')}
                type={passwordText(showPasswords)}
                autoComplete="current-password"
                className="md:col-span-2 md:max-w-[calc(50%-0.75rem)]"
              />
            )}
            <TextField
              label={lock.appPassword ? 'Nova senha' : 'Senha'}
              description={`Pelo menos ${MIN_PASSWORD_LENGTH} letras ou números. Anote em lugar seguro.`}
              error={errors.password}
              value={values.password}
              onChange={set('password')}
              type={passwordText(showPasswords)}
              autoComplete="new-password"
            />
            <TextField
              label={
                lock.appPassword ? 'Repita a nova senha' : 'Repita a senha'
              }
              error={errors.repeat}
              value={values.repeat}
              onChange={set('repeat')}
              type={passwordText(showPasswords)}
              autoComplete="new-password"
            />
          </FieldGroup>
          <div className="flex items-center gap-3">
            <Checkbox
              id={showId}
              checked={showPasswords}
              onCheckedChange={(checked) => setShowPasswords(checked === true)}
            />
            <Label htmlFor={showId} className="text-base font-normal">
              Mostrar as senhas
            </Label>
          </div>
        </CardContent>
        <CardFooter className="flex flex-wrap items-center justify-between gap-3">
          <Button type="submit" size="lg" disabled={save.pending}>
            <KeyRound aria-hidden="true" />
            {save.pending
              ? 'Salvando…'
              : lock.appPassword
                ? 'Trocar senha'
                : 'Criar senha'}
          </Button>
          {lock.appPassword && (
            <RemovePasswordDialog envPassword={lock.envPassword} />
          )}
        </CardFooter>
      </form>
      {lock.locked && (
        <>
          <Separator />
          <form
            method="post"
            action="/api/bloquear"
            className="flex flex-wrap items-center justify-between gap-4 px-6"
          >
            <p className="max-w-[52ch] text-muted-foreground">
              Usou um computador emprestado? Saia para que ele volte a pedir a
              senha.
            </p>
            <Button type="submit" variant="outline">
              <LogOut aria-hidden="true" />
              Sair deste aparelho
            </Button>
          </form>
        </>
      )}
    </Card>
  )
}

function LockStatus({ lock }: { lock: Settings['lock'] }) {
  if (!lock.locked) {
    return (
      <Notice tone="warning">
        O app está sem senha: qualquer pessoa que tenha o endereço dele vê e
        altera os dados. Crie uma senha abaixo.
      </Notice>
    )
  }
  if (!lock.appPassword) {
    return (
      <Notice>
        O app já pede a senha do servidor, definida na instalação. Você pode
        criar outra aqui: qualquer uma das duas abre o app.
      </Notice>
    )
  }
  return (
    <Notice>
      {lock.envPassword
        ? 'O app pede senha para entrar. Abre com esta senha ou com a senha do servidor, definida na instalação.'
        : 'O app pede esta senha para entrar, em todos os aparelhos.'}
    </Notice>
  )
}

function RemovePasswordDialog({ envPassword }: { envPassword: boolean }) {
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [error, setError] = useState<string>()
  const remove = useAction(removeAppPassword, {
    success: envPassword
      ? 'Senha removida. O app continua pedindo a senha do servidor.'
      : 'Senha removida. O app abre sem senha.',
    onError: setError,
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    const result = await remove.run({ data: { current } })
    if (result) setOpen(false)
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setCurrent('')
          setError(undefined)
        }
      }}
    >
      <AlertDialogTrigger asChild>
        <Button variant="outline" className={dangerOutline}>
          <Trash2 aria-hidden="true" />
          Remover senha
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl">
              Remover a senha?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-base">
              {envPassword
                ? 'O app continua pedindo a senha do servidor, definida na instalação.'
                : 'O app volta a abrir sem senha: qualquer pessoa que tenha o endereço dele vê e altera os dados.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <TextField
            label="Senha atual"
            error={error}
            value={current}
            onChange={(value) => {
              setCurrent(value)
              setError(undefined)
            }}
            type="password"
            autoComplete="current-password"
            autoFocus
          />
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Voltar</AlertDialogCancel>
            <Button
              type="submit"
              variant="destructive"
              disabled={remove.pending || !current}
            >
              {remove.pending ? 'Removendo…' : 'Remover senha'}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}

function BackupSection() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-2xl">Cópia de segurança</CardTitle>
        <CardDescription className="text-base">
          Um arquivo com todos os cadastros, leituras e pagamentos. Guarde em um
          pendrive ou no e-mail, de vez em quando.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" size="lg" asChild>
          <a href="/api/backup" download>
            <Download aria-hidden="true" />
            Baixar cópia dos dados
          </a>
        </Button>
      </CardContent>
    </Card>
  )
}

type LegacyImport = Awaited<ReturnType<typeof importLegacyZip>>

function LegacyImportSection() {
  const inputId = useId()
  const [file, setFile] = useState<File | null>(null)
  // A new key empties the file field after an import.
  const [inputKey, setInputKey] = useState(0)
  const [result, setResult] = useState<LegacyImport | null>(null)
  const upload = useAction(importLegacyZip, {
    success: (imported) =>
      imported.created + imported.readings > 0
        ? 'Dados do sistema antigo importados.'
        : 'Nada novo: esses dados já estavam no app.',
  })

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    const data = new FormData()
    data.set('arquivo', file)
    const imported = await upload.run({ data })
    if (imported) {
      setResult(imported)
      setFile(null)
      setInputKey((key) => key + 1)
    }
  }

  return (
    <Card>
      <form onSubmit={submit} className="flex flex-col gap-6">
        <CardHeader>
          <CardTitle className="text-2xl">Dados do sistema antigo</CardTitle>
          <CardDescription className="text-base">
            Traz o histórico do programa antigo (Access): envie o arquivo .zip
            com T_Usuarios.csv, T_Fatura.csv e T_Consumo.csv. Só entra o que
            ainda não está no app; nada do que já existe muda.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <div className="flex max-w-md flex-col gap-2">
            <Label htmlFor={inputId} className="text-base">
              Arquivo .zip
            </Label>
            <Input
              key={inputKey}
              id={inputId}
              type="file"
              accept=".zip,application/zip"
              className="h-11 py-2 text-base file:h-7 file:text-base md:text-base"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {result && <LegacyImportSummary result={result} />}
        </CardContent>
        <CardFooter>
          <Button type="submit" size="lg" disabled={!file || upload.pending}>
            <Upload aria-hidden="true" />
            {upload.pending ? 'Importando…' : 'Importar'}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

const count = (value: number, one: string, many: string) =>
  `${value} ${value === 1 ? one : many}`

function LegacyImportSummary({ result }: { result: LegacyImport }) {
  return (
    <Alert role="status" className="border-primary/30 bg-secondary">
      <CircleCheck aria-hidden="true" />
      <AlertTitle className="text-base">Importação concluída</AlertTitle>
      <AlertDescription className="text-base text-foreground">
        <ul className="list-disc space-y-1 pl-5">
          <li>
            {count(result.created, 'chácara nova', 'chácaras novas')} e{' '}
            {count(result.readings, 'leitura importada', 'leituras importadas')}
            .
          </li>
          {(result.matched > 0 || result.existing > 0) && (
            <li>
              Já estavam no app e não mudaram:{' '}
              {count(result.matched, 'chácara', 'chácaras')} e{' '}
              {count(result.existing, 'leitura', 'leituras')}.
            </li>
          )}
          {result.skipped.length > 0 && (
            <li>
              {count(
                result.skipped.length,
                'registro não importado',
                'registros não importados',
              )}
              :
              <ul className="mt-1 list-[circle] pl-5 text-muted-foreground">
                {result.skipped.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </li>
          )}
        </ul>
      </AlertDescription>
    </Alert>
  )
}
