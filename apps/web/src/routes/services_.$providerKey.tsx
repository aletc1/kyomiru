import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { PROVIDER_META } from '@/lib/providers'
import type { ServiceInfo } from '@kyomiru/shared/contracts/services'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { ArrowLeft, CheckCircle2, Copy, Plus, MonitorSmartphone } from 'lucide-react'
import { useExtensionTokens } from '@/hooks/useExtensionTokens'
import type { CreateExtensionTokenResponse } from '@kyomiru/shared/contracts/ingest'

export const Route = createFileRoute('/services_/$providerKey')({
  component: ServiceDetailPage,
})

function ServiceDetailPage() {
  const { providerKey } = Route.useParams()
  const navigate = useNavigate()

  const { data: services } = useQuery<ServiceInfo[]>({
    queryKey: Q.services,
    queryFn: () => api.get<ServiceInfo[]>('/services'),
  })
  const svc = services?.find((s) => s.providerKey === providerKey)
  const displayName = svc?.displayName ?? providerKey
  const meta = PROVIDER_META[providerKey]

  return (
    <div className="max-w-md space-y-4">
      <Button variant="ghost" size="sm" onClick={() => navigate({ to: '/services' })}>
        <ArrowLeft className="h-4 w-4 mr-2" /> Back
      </Button>
      {meta?.connectionKind === 'extension' ? (
        <ExtensionServiceCard svc={svc} providerKey={providerKey} displayName={displayName} />
      ) : (
        <BearerTokenCard svc={svc} providerKey={providerKey} displayName={displayName} />
      )}
    </div>
  )
}

function InlineCreateToken({
  onCreated,
}: {
  onCreated: (result: CreateExtensionTokenResponse) => void
}) {
  const [label, setLabel] = useState('')
  const { create, tokens } = useExtensionTokens()

  const hasDevices = (tokens ?? []).length > 0

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      {hasDevices ? (
        <p className="text-xs text-muted-foreground">
          <MonitorSmartphone className="inline h-3.5 w-3.5 mr-1" />
          You already have {tokens!.length} device{tokens!.length > 1 ? 's' : ''} paired.{' '}
          <Link to="/settings" className="underline font-medium">Manage in Settings → Devices</Link>
          {' '}or add another below.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Create an extension token to link this device to your Kyomiru account.
        </p>
      )}
      <div className="flex gap-2">
        <Input
          placeholder={hasDevices ? 'e.g. Work laptop' : 'e.g. Personal laptop'}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          maxLength={64}
          className="h-8 text-sm"
        />
        <Button
          size="sm"
          onClick={() => create.mutate(label, {
            onSuccess: (r) => {
              setLabel('')
              onCreated(r)
            },
          })}
          disabled={!label.trim() || create.isPending}
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          {create.isPending ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </div>
  )
}

function TokenRevealDialog({
  result,
  onClose,
}: {
  result: CreateExtensionTokenResponse | null
  onClose: () => void
}) {
  const copyToken = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.token)
    toast.success('Token copied to clipboard')
  }

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your new extension token</DialogTitle>
          <DialogDescription>
            Copy this now — you won't be able to see it again. Paste it into the Kyomiru Chrome extension popup.
          </DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs break-all">
              {result.token}
            </div>
            <Button onClick={copyToken} className="w-full">
              <Copy className="h-4 w-4 mr-2" /> Copy to clipboard
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ExtensionServiceCard({
  svc,
  providerKey,
  displayName,
}: {
  svc: ServiceInfo | undefined
  providerKey: string
  displayName: string
}) {
  const meta = PROVIDER_META[providerKey]
  const [justCreated, setJustCreated] = useState<CreateExtensionTokenResponse | null>(null)
  const connected = svc?.status === 'connected'
  const pending = !connected && svc?.pairingState === 'pending'

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {displayName}
            {connected && <CheckCircle2 className="h-4 w-4 text-green-500" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {connected ? (
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                Synced via the Kyomiru Chrome extension.
              </p>
              {svc?.lastSyncAt && (
                <p className="text-xs text-muted-foreground">
                  Last sync: <span className="text-foreground">{new Date(svc.lastSyncAt).toLocaleString()}</span>
                </p>
              )}
              {svc?.lastError && <p className="text-xs text-destructive">{svc.lastError}</p>}
            </div>
          ) : pending ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">Device paired — waiting for first sync</p>
                <p>Open the extension popup, log in to{' '}
                  <a href={meta?.siteUrl} target="_blank" rel="noreferrer" className="underline">
                    {meta?.siteLabel ?? displayName}
                  </a>
                  , then click <strong>Sync now</strong>.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                <Link to="/settings" className="underline font-medium">Settings → Devices</Link>
                {' '}to manage your paired devices.
              </p>
            </div>
          ) : (
            <ol className="space-y-4 text-sm list-decimal list-inside">
              <li>
                Install the <strong>Kyomiru</strong> Chrome extension
                <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                  Build it from <code>apps/extension</code> and load it unpacked in Chrome → Extensions → Developer mode.
                </p>
              </li>
              <li>
                Create an extension token for this device
                <div className="mt-2 ml-0">
                  <InlineCreateToken onCreated={setJustCreated} />
                </div>
              </li>
              <li>
                Open the extension popup and paste your Kyomiru URL + the token
              </li>
              <li>
                Log in to{' '}
                <a href={meta?.siteUrl} target="_blank" rel="noreferrer" className="underline">
                  {meta?.siteLabel ?? displayName}
                </a>
                , then click <strong>Sync now</strong> in the extension
              </li>
            </ol>
          )}
        </CardContent>
      </Card>

      <TokenRevealDialog result={justCreated} onClose={() => setJustCreated(null)} />
    </>
  )
}

function BearerTokenCard({
  svc,
  providerKey,
  displayName,
}: {
  svc: ServiceInfo | undefined
  providerKey: string
  displayName: string
}) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(`/services/${providerKey}/test`, { token }),
    onSuccess: (d) => d.ok ? toast.success('Connection successful!') : toast.error(d.error ?? 'Connection failed'),
    onError: (err) => toast.error(err.message),
  })

  const connect = useMutation({
    mutationFn: () => api.post(`/services/${providerKey}/connect`, { token }),
    onSuccess: () => {
      toast.success('Connected!')
      queryClient.invalidateQueries({ queryKey: Q.services })
      navigate({ to: '/services' })
    },
    onError: (err) => toast.error(err.message),
  })

  const disconnect = useMutation({
    mutationFn: () => api.post(`/services/${providerKey}/disconnect`),
    onSuccess: () => {
      toast.success('Disconnected. Your data is preserved.')
      queryClient.invalidateQueries({ queryKey: Q.services })
      navigate({ to: '/services' })
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>{displayName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {svc?.status === 'connected' ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Connected. Your credentials are stored encrypted and your data will be preserved if you disconnect.
            </p>
            {svc.lastSyncAt && <p className="text-xs text-muted-foreground">Last sync: {new Date(svc.lastSyncAt).toLocaleString()}</p>}
            <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="w-full">
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">Bearer Token</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="Paste the Bearer JWT access token"
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">
                Sign in to the provider's website, open DevTools → Network, pick an authenticated API request, copy the value of the
                {' '}<code className="text-foreground">Authorization</code> header (the part after
                {' '}<code className="text-foreground">Bearer</code>) and paste it here.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !token} className="flex-1">
                {test.isPending ? 'Testing…' : 'Test'}
              </Button>
              <Button onClick={() => connect.mutate()} disabled={connect.isPending || !token} className="flex-1">
                {connect.isPending ? 'Connecting…' : 'Connect'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
