import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/relatorios/')({
  beforeLoad: () => {
    throw redirect({ to: '/relatorios/mensal' })
  },
})
