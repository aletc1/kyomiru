import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { formatRelative } from '@/lib/utils'
import { PROVIDER_META } from '@/lib/providers'
import type { ServiceInfo } from '@kyomiru/shared/contracts/services'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react'

export const Route = createFileRoute('/services')({
  component: ServicesPage,
})

function StatusIcon({ status, pairingState }: { status: ServiceInfo['status']; pairingState?: ServiceInfo['pairingState'] }) {
  if (status === 'connected') return <CheckCircle2 className="h-5 w-5 text-green-500" />
  if (status === 'error') return <AlertCircle className="h-5 w-5 text-destructive" />
  if (pairingState === 'pending') return <Clock className="h-5 w-5 text-amber-500" />
  return <XCircle className="h-5 w-5 text-muted-foreground" />
}

function ServicesPage() {
  const { data: services, isLoading } = useQuery<ServiceInfo[]>({
    queryKey: Q.services,
    queryFn: () => api.get<ServiceInfo[]>('/services'),
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => <div key={i} className="h-32 rounded-lg bg-muted animate-pulse" />)}
      </div>
    )
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Services</h1>
        <p className="text-sm text-muted-foreground">Connect streaming services to sync your watch history.</p>
      </div>
      {(services ?? []).map((svc) => {
        const meta = PROVIDER_META[svc.providerKey] ?? { tagline: '', connectionKind: 'bearer' as const, siteUrl: '', siteLabel: '' }
        const lastSync = formatRelative(svc.lastSyncAt)
        return (
          <Card key={svc.providerKey}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <StatusIcon status={svc.status} pairingState={svc.pairingState} />
              <div className="flex-1">
                <CardTitle className="text-lg">{svc.displayName}</CardTitle>
                {meta.tagline && (
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.tagline}</p>
                )}
              </div>
              <Badge variant={svc.status === 'connected' ? 'default' : 'secondary'}>
                {svc.status === 'connected'
                  ? 'connected'
                  : svc.pairingState === 'pending'
                    ? 'waiting for sync'
                    : svc.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {svc.status === 'connected' ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {lastSync ? (
                    <p>
                      Last sync: <span className="text-foreground">{lastSync}</span>
                      {svc.lastSyncAt && (
                        <span className="ml-1 opacity-60">({new Date(svc.lastSyncAt).toLocaleString()})</span>
                      )}
                    </p>
                  ) : (
                    <p>Connected, but no sync has run yet.</p>
                  )}
                  {svc.lastError && <p className="text-destructive">{svc.lastError}</p>}
                </div>
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {svc.pairingState === 'pending' ? (
                    <p>Device paired — open the extension and click <strong>Sync now</strong>.</p>
                  ) : meta.connectionKind === 'extension' ? (
                    <p>Not connected. Install the extension and create a device token to get started.</p>
                  ) : (
                    <p>Not connected. Paste a bearer token from the provider's website to connect.</p>
                  )}
                  {svc.lastError && <p className="text-destructive">{svc.lastError}</p>}
                </div>
              )}
              <Button variant={svc.status === 'connected' ? 'outline' : 'default'} size="sm" asChild>
                <Link to="/services/$providerKey" params={{ providerKey: svc.providerKey }}>
                  {svc.status === 'connected' ? 'Manage' : svc.pairingState === 'pending' ? 'View' : 'Connect'}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
