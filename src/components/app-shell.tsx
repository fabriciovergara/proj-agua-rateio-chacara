import { Link, useRouterState } from '@tanstack/react-router'
import {
  ChartColumnBig,
  FileText,
  Gauge,
  History,
  Settings,
  Users,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'

const NAVIGATION = [
  { to: '/', label: 'Leituras', icon: Gauge, exact: true },
  { to: '/relatorios', label: 'Relatórios', icon: FileText, exact: false },
  { to: '/cadastros', label: 'Cadastros', icon: Users, exact: false },
  { to: '/historico', label: 'Histórico', icon: History, exact: false },
  { to: '/graficos', label: 'Gráficos', icon: ChartColumnBig, exact: false },
  {
    to: '/configuracoes',
    label: 'Configurações',
    icon: Settings,
    exact: false,
  },
] as const

export function AppMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={className}>
      <path
        fill="currentColor"
        d="M16 2.5S5.5 14.3 5.5 20.6a10.5 10.5 0 0 0 21 0C26.5 14.3 16 2.5 16 2.5Z"
      />
      <path fill="#fff" d="M17.6 11.5 11.8 21h4.1l-1.4 6.2 6.1-9.5h-4.2z" />
    </svg>
  )
}

function LoadingBar() {
  const loading = useRouterState({ select: (state) => state.isLoading })
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden"
    >
      <div
        className={`h-full origin-left bg-primary transition-[transform,opacity] duration-500 ${
          loading ? 'scale-x-75 opacity-100' : 'scale-x-100 opacity-0'
        }`}
      />
    </div>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <LoadingBar />
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2"
      >
        Pular para o conteúdo
      </a>

      <header className="border-b bg-background print:hidden">
        <div className="mx-auto flex w-full max-w-[76rem] flex-col gap-3 px-4 pt-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:gap-8 lg:py-3">
          <Link to="/" className="flex items-center gap-3 self-start">
            <AppMark className="size-10 text-plate" />
            <span className="flex flex-col leading-tight">
              <span className="text-[1.3rem] font-bold">Rateio da Água</span>
              <span className="text-sm text-muted-foreground">
                Energia da bomba d’água
              </span>
            </span>
          </Link>

          <nav aria-label="Principal" className="-mx-4 sm:mx-0">
            <ul className="flex gap-1 overflow-x-auto px-4 pb-3 sm:px-0 lg:pb-0">
              {NAVIGATION.map(({ to, label, icon: Icon, exact }) => (
                <li key={to} className="shrink-0">
                  <Button
                    variant="ghost"
                    asChild
                    className="h-11 rounded-full px-4 text-base font-semibold text-muted-foreground hover:text-accent-foreground data-[status=active]:bg-primary data-[status=active]:text-primary-foreground [&_svg:not([class*='size-'])]:size-5"
                  >
                    <Link to={to} activeOptions={{ exact }}>
                      <Icon aria-hidden="true" />
                      {label}
                    </Link>
                  </Button>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>

      <main
        id="conteudo"
        className="mx-auto w-full max-w-[76rem] flex-1 px-4 py-8 sm:px-6 sm:py-10 print:max-w-none print:p-0"
      >
        {children}
      </main>
    </div>
  )
}
