import {
  createRootRoute,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppShell } from '#/components/app-shell'
import { Toaster } from '#/components/ui/sonner'
import appCss from '../styles.css?url'

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Rateio da Água' },
      {
        name: 'description',
        content:
          'Leituras, cobranças e pagamentos da energia da bomba d’água das chácaras.',
      },
      { name: 'theme-color', content: '#ffffff' },
    ],
    links: [
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
    ],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
})

function RootLayout() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  })
  // While locked there is nothing to navigate to: just the unlock card.
  if (pathname === '/desbloquear') {
    return (
      <main className="grid min-h-dvh place-items-center p-4">
        <Outlet />
      </main>
    )
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  )
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Toaster position="top-center" richColors closeButton />
        <Scripts />
      </body>
    </html>
  )
}
