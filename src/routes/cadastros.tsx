import { createFileRoute, Outlet } from '@tanstack/react-router'
import { PageHeader } from '#/components/page'
import { SectionTabs } from '#/components/section-tabs'

export const Route = createFileRoute('/cadastros')({
  component: RegistryLayout,
})

function RegistryLayout() {
  return (
    <div>
      <PageHeader
        title="Cadastros"
        description="As chácaras e seus proprietários. Clique em uma linha para ver ou corrigir os dados."
      />
      <SectionTabs
        label="Tipo de cadastro"
        items={[
          { to: '/cadastros/chacaras', label: 'Chácaras' },
          { to: '/cadastros/proprietarios', label: 'Proprietários' },
        ]}
      />
      <Outlet />
    </div>
  )
}
