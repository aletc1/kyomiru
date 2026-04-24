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
import { ArrowLeft, CheckCircle2 } from 'lucide-react'

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

function ExtensionServiceCard({
  svc,
  providerKey,
  displayName,
}: {
  svc: ServiceInfo | undefined
  providerKey: string
  displayName: string
}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const meta = PROVIDER_META[providerKey]

  const disconnect = useMutation({
    mutationFn: () => api.post(`/services/${providerKey}/disconnect`),
    onSuccess: () => {
      toast.success('Disconnected. Your watched data is preserved.')
      queryClient.invalidateQueries({ queryKey: Q.services })
      navigate({ to: '/services' })
    },
    onError: (err) => toast.error(err.message),
  })

  const connected = svc?.status === 'connected'

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {displayName}
          {connected && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected ? (
          <>
            <div className="space-y-1 text-sm">
              <p className="text-muted-foreground">
                Synced via the Kyomiru Chrome extension. Your watched history is preserved if you disconnect.
              </p>
              {svc?.lastSyncAt && (
                <p className="text-xs text-muted-foreground">
                  Last sync: <span className="text-foreground">{new Date(svc.lastSyncAt).toLocaleString()}</span>
                </p>
              )}
              {svc?.lastError && <p className="text-xs text-destructive">{svc.lastError}</p>}
            </div>
            <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="w-full">
              {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {displayName} syncs via your browser session through a Chrome extension — no passwords stored.
            </p>
            <ol className="space-y-3 text-sm list-decimal list-inside">
              <li>
                Install the <strong>Kyomiru</strong> Chrome extension
                <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                  Build it from <code>apps/extension</code> and load it unpacked in Chrome → Extensions → Developer mode.
                </p>
              </li>
              <li>
                Create an extension token in{' '}
                <Link to="/settings" className="underline font-medium">Settings → Extension tokens</Link>
                <p className="text-xs text-muted-foreground mt-0.5 ml-5">
                  The token is shown once. Copy it and keep it safe.
                </p>
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
            <div className="rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
              Your status will flip to <span className="font-medium text-foreground">connected</span> after the extension's first successful sync.
            </div>
          </>
        )}
      </CardContent>
    </Card>
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
