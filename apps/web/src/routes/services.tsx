import { createFileRoute, Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { formatRelative } from '@/lib/utils'
import { PROVIDER_META } from '@/lib/providers'
import type { ServiceInfo } from '@kyomiru/shared/contracts/services'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CheckCircle2, XCircle, AlertCircle, Clock } from 'lucide-react'
import i18n from '@/i18n'

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
  const { t } = useTranslation('services')
  const { data: services, isLoading } = useQuery<ServiceInfo[]>({
    queryKey: Q.services,
    queryFn: () => api.get<ServiceInfo[]>('/services'),
  })

  const tagline = (key: string) => t(`provider_tagline_${key}`, { defaultValue: PROVIDER_META[key]?.tagline ?? '' })

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
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>
      {(services ?? []).map((svc) => {
        const meta = PROVIDER_META[svc.providerKey] ?? { tagline: '', connectionKind: 'bearer' as const, siteUrl: '', siteLabel: '' }
        const lastSync = formatRelative(svc.lastSyncAt, i18n.language)
        return (
          <Card key={svc.providerKey}>
            <CardHeader className="flex flex-row items-center gap-3 pb-2">
              <StatusIcon status={svc.status} pairingState={svc.pairingState} />
              <div className="flex-1">
                <CardTitle className="text-lg">{svc.displayName}</CardTitle>
                {meta.tagline && (
                  <p className="text-xs text-muted-foreground mt-0.5">{tagline(svc.providerKey)}</p>
                )}
              </div>
              <Badge variant={svc.status === 'connected' ? 'default' : 'secondary'}>
                {svc.status === 'connected'
                  ? t('badge_connected')
                  : svc.pairingState === 'pending'
                    ? t('badge_waiting')
                    : svc.status}
              </Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {svc.status === 'connected' ? (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {lastSync ? (
                    <p>
                      {t('last_sync', { when: lastSync })}
                      {svc.lastSyncAt && (
                        <span className="ml-1 opacity-60">({new Date(svc.lastSyncAt).toLocaleString()})</span>
                      )}
                    </p>
                  ) : (
                    <p>{t('no_sync_yet')}</p>
                  )}
                  {svc.lastError && <p className="text-destructive">{svc.lastError}</p>}
                </div>
              ) : (
                <div className="space-y-1 text-xs text-muted-foreground">
                  {svc.pairingState === 'pending' ? (
                    <p>{t('pending_device')}</p>
                  ) : meta.connectionKind === 'extension' ? (
                    <p>{t('not_connected_extension')}</p>
                  ) : (
                    <p>{t('not_connected_bearer')}</p>
                  )}
                  {svc.lastError && <p className="text-destructive">{svc.lastError}</p>}
                </div>
              )}
              <Button variant={svc.status === 'connected' ? 'outline' : 'default'} size="sm" asChild>
                <Link to="/services/$providerKey" params={{ providerKey: svc.providerKey }}>
                  {svc.status === 'connected' ? t('manage') : svc.pairingState === 'pending' ? t('view') : t('connect')}
                </Link>
              </Button>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
