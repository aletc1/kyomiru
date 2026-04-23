import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import type { ServiceInfo } from '@kyomiru/shared/contracts/services'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, AlertCircle, Chrome } from 'lucide-react'

export const Route = createFileRoute('/services')({
  component: ServicesPage,
})

const PROVIDER_META: Record<string, { tagline: string; connectionKind: 'extension' | 'bearer' }> = {
  crunchyroll: {
    tagline: 'Anime simulcasts. Synced from your browser via the Kyomiru Chrome extension.',
    connectionKind: 'extension',
  },
  netflix: {
    tagline: 'Movies and TV. Requires a bearer token from the Netflix web app.',
    connectionKind: 'bearer',
  },
  prime: {
    tagline: 'Prime Video catalogue. Requires a bearer token from the Prime Video web app.',
    connectionKind: 'bearer',
  },
}

function StatusIcon({ status }: { status: ServiceInfo['status'] }) {
  if (status === 'connected') return <CheckCircle2 className="h-5 w-5 text-green-500" />
  if (status === 'error') return <AlertCircle className="h-5 w-5 text-destructive" />
  return <XCircle className="h-5 w-5 text-muted-foreground" />
}

function formatWhen(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
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
        const meta = PROVIDER_META[svc.providerKey] ?? { tagline: '', connectionKind: 'bearer' as const }
        const lastSync = formatWhen(svc.lastSyncAt)
        return (
          <Card key={svc.providerKey}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <StatusIcon status={svc.status} />
              <div className="flex-1">
                <CardTitle className="text-lg">{svc.displayName}</CardTitle>
                {meta.tagline && (
                  <p className="text-xs text-muted-foreground mt-0.5">{meta.tagline}</p>
                )}
              </div>
              <Badge variant={svc.status === 'connected' ? 'default' : 'secondary'}>
                {svc.status}
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
                  {meta.connectionKind === 'extension' ? (
                    <p className="flex items-center gap-1.5">
                      <Chrome className="h-3.5 w-3.5" />
                      Install the Kyomiru Chrome extension, then create an extension token to connect.
                    </p>
                  ) : (
                    <p>Not connected. Paste a bearer token from the provider's website to connect.</p>
                  )}
                  {svc.lastError && <p className="text-destructive">{svc.lastError}</p>}
                </div>
              )}
              <Button variant={svc.status === 'connected' ? 'outline' : 'default'} size="sm" asChild>
                <Link to="/services/$providerKey" params={{ providerKey: svc.providerKey }}>
                  {svc.status === 'connected' ? 'Manage' : 'Connect'}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
