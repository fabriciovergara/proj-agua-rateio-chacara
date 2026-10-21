import {
  createRouter as createTanStackRouter,
  type ErrorComponentProps,
  Link,
  useRouter,
} from '@tanstack/react-router'
import { Button } from '#/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '#/components/ui/card'
import { errorMessage } from '#/lib/errors'
import { routeTree } from './routeTree.gen'

function ErrorScreen({ error, reset }: ErrorComponentProps) {
  const router = useRouter()
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">Algo deu errado</CardTitle>
        <CardDescription className="text-base">
          {errorMessage(error)}
        </CardDescription>
      </CardHeader>
      <CardFooter className="flex flex-wrap gap-3">
        <Button
          onClick={() => {
            reset()
            router.invalidate()
          }}
        >
          Tentar de novo
        </Button>
        <Button variant="outline" asChild>
          <Link to="/">Voltar para as leituras</Link>
        </Button>
      </CardFooter>
    </Card>
  )
}

function NotFoundScreen() {
  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-2xl">Página não encontrada</CardTitle>
        <CardDescription className="text-base">
          O endereço pode ter mudado ou o registro foi apagado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link to="/">Voltar para as leituras</Link>
        </Button>
      </CardContent>
    </Card>
  )
}

export function getRouter() {
  const router = createTanStackRouter({
    routeTree,
    scrollRestoration: true,
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: ErrorScreen,
    defaultNotFoundComponent: NotFoundScreen,
  })

  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
