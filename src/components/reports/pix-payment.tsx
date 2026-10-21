import { Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'

/** QR code + "copia e cola" text, both carrying the amount of the bill. */
export function PixPayment({ payload }: { payload: string }) {
  async function copy() {
    try {
      await navigator.clipboard.writeText(payload)
      toast.success('Código Pix copiado. Cole no aplicativo do banco.')
    } catch {
      toast.error('Não foi possível copiar. Selecione o código e copie à mão.')
    }
  }

  return (
    <div className="flex max-w-[16rem] flex-col items-center gap-3">
      <div className="rounded-lg border bg-white p-3">
        <QRCodeSVG
          value={payload}
          size={176}
          level="M"
          title="QR Code Pix para pagar esta cobrança"
        />
      </div>
      <p className="text-center text-sm text-muted-foreground">
        Abra o aplicativo do banco, escolha Pix e aponte a câmera para o código.
      </p>
      <details className="w-full print:hidden">
        <summary className="cursor-pointer text-center font-semibold text-primary">
          Pix copia e cola
        </summary>
        <p className="mt-2 rounded-md bg-muted p-2 font-mono text-xs break-all text-muted-foreground">
          {payload}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="mt-2 w-full"
          onClick={copy}
        >
          <Copy aria-hidden="true" />
          Copiar código
        </Button>
      </details>
    </div>
  )
}
