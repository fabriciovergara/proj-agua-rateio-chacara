import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PageHeader } from '#/components/page'
import { SectionTabs } from '#/components/section-tabs'

export const Route = createFileRoute('/relatorios')({
  component: ReportsLayout,
})

function ReportsLayout() {
  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Relatórios"
          description="Cobranças de cada período para enviar aos proprietários e o resumo do ano. Tudo pode ser impresso ou salvo em PDF."
        />
        <SectionTabs
          label="Tipo de relatório"
          items={[
            { to: '/relatorios/periodo', label: 'Cobranças do período' },
            { to: '/relatorios/anual', label: 'Relatório anual' },
          ]}
        />
      </div>
      <Outlet />
    </div>
  )
}
