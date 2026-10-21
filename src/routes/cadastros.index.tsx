import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/cadastros/')({
  beforeLoad: () => {
    throw redirect({ to: '/cadastros/chacaras' })
  },
})
