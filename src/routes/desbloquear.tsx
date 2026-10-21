import { createFileRoute } from '@tanstack/react-router'
import { LockKeyhole } from 'lucide-react'
import { useId, useState } from 'react'
import { z } from 'zod'
import { AppMark } from '#/components/app-shell'
import { Alert, AlertDescription } from '#/components/ui/alert'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'

/*
 * The only page available while the app is locked. It has no loader and
 * calls no server function: it only posts the password to /api/desbloquear.
 */
export const Route = createFileRoute('/desbloquear')({
  validateSearch: z.object({
    voltar: z.string().optional().catch(undefined),
    erro: z.enum(['senha', 'tentativas']).optional().catch(undefined),
  }),
  head: () => ({ meta: [{ title: 'Entrar — Rateio da Água' }] }),
  component: UnlockPage,
})

const ERRORS = {
  senha: 'Senha incorreta. Confira e tente de novo.',
  tentativas: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
} as const

function UnlockPage() {
  const { voltar, erro } = Route.useSearch()
  const [showPassword, setShowPassword] = useState(false)
  const passwordId = useId()
  const showId = useId()

  return (
    <Card className="w-full max-w-md">
      <CardHeader className="items-center text-center">
        <AppMark className="mx-auto size-14 text-plate" />
        <CardTitle className="text-2xl">Rateio da Água</CardTitle>
        <CardDescription className="text-base">
          Digite a senha para ver e lançar as leituras.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          method="post"
          action="/api/desbloquear"
          className="flex flex-col gap-5"
        >
          {erro && (
            <Alert
              variant="destructive"
              role="alert"
              className="border-destructive/40 bg-destructive/5"
            >
              <AlertDescription className="text-base">
                {ERRORS[erro]}
              </AlertDescription>
            </Alert>
          )}
          <input type="hidden" name="voltar" value={voltar ?? '/'} />
          <div className="flex flex-col gap-2">
            <Label htmlFor={passwordId} className="text-base">
              Senha
            </Label>
            <Input
              id={passwordId}
              name="senha"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              autoFocus
              required
              className="h-12 text-lg md:text-lg"
            />
          </div>
          <div className="flex items-center gap-3">
            <Checkbox
              id={showId}
              checked={showPassword}
              onCheckedChange={(checked) => setShowPassword(checked === true)}
            />
            <Label htmlFor={showId} className="text-base font-normal">
              Mostrar a senha
            </Label>
          </div>
          <Button type="submit" size="lg" className="h-12 text-base">
            <LockKeyhole aria-hidden="true" />
            Entrar
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
