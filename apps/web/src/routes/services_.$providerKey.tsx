import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api, translateApiError } from '@/lib/api'
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
  const { t } = useTranslation('services')
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
        <ArrowLeft className="h-4 w-4 mr-2" /> {t('back')}
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
  const { t } = useTranslation('services')
  const [label, setLabel] = useState('')
  const { create, tokens } = useExtensionTokens()
  const hasDevices = (tokens ?? []).length > 0

  return (
    <div className="rounded-md border bg-muted/30 p-3 space-y-2">
      {hasDevices ? (
        <p className="text-xs text-muted-foreground">
          <MonitorSmartphone className="inline h-3.5 w-3.5 mr-1" />
          {t('devices_paired', { count: tokens!.length })}{' '}
          <Link to="/settings" className="underline font-medium">{t('manage_devices_link')}</Link>
          {' '}{t('manage_or_add')}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">{t('create_token_hint')}</p>
      )}
      <div className="flex gap-2">
        <Input
          placeholder={hasDevices ? t('device_placeholder_extra') : t('device_placeholder_first')}
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
          {create.isPending ? t('creating') : t('create')}
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
  const { t } = useTranslation('services')
  const copyToken = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.token)
    toast.success(t('token_copied'))
  }

  return (
    <Dialog open={result !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('new_token_title')}</DialogTitle>
          <DialogDescription>{t('new_token_desc')}</DialogDescription>
        </DialogHeader>
        {result && (
          <div className="space-y-3">
            <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs break-all">
              {result.token}
            </div>
            <Button onClick={copyToken} className="w-full">
              <Copy className="h-4 w-4 mr-2" /> {t('copy_to_clipboard')}
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
  const { t } = useTranslation('services')
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
              <p className="text-muted-foreground">{t('synced_via_extension')}</p>
              {svc?.lastSyncAt && (
                <p className="text-xs text-muted-foreground">
                  {t('last_sync_at', { when: new Date(svc.lastSyncAt).toLocaleString() })}
                </p>
              )}
              {svc?.lastError && <p className="text-xs text-destructive">{svc.lastError}</p>}
            </div>
          ) : pending ? (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                <p className="font-medium text-foreground mb-1">{t('pending_title')}</p>
                <p>{t('pending_body', { provider: meta?.siteLabel ?? displayName })}</p>
              </div>
              <p className="text-xs text-muted-foreground">
                <Link to="/settings" className="underline font-medium">{t('manage_devices_link')}</Link>
                {' '}{t('manage_or_add')}
              </p>
            </div>
          ) : (
            <ol className="space-y-4 text-sm list-decimal list-inside">
              <li>
                {t('install_step1')}
                <p className="text-xs text-muted-foreground mt-0.5 ml-5">{t('install_step1_hint')}</p>
              </li>
              <li>
                {t('install_step2')}
                <div className="mt-2 ml-0">
                  <InlineCreateToken onCreated={setJustCreated} />
                </div>
              </li>
              <li>{t('install_step3')}</li>
              <li>
                {t('install_step4', { provider: meta?.siteLabel ?? displayName })}
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
  const { t } = useTranslation('services')
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [token, setToken] = useState('')

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; error?: string }>(`/services/${providerKey}/test`, { token }),
    onSuccess: (d) => d.ok ? toast.success(t('connection_successful')) : toast.error(d.error ? translateApiError(d.error) : t('common:error_internal')),
    onError: (err) => toast.error(err.message),
  })

  const connect = useMutation({
    mutationFn: () => api.post(`/services/${providerKey}/connect`, { token }),
    onSuccess: () => {
      toast.success(t('connected_toast'))
      queryClient.invalidateQueries({ queryKey: Q.services })
      navigate({ to: '/services' })
    },
    onError: (err) => toast.error(err.message),
  })

  const disconnect = useMutation({
    mutationFn: () => api.post(`/services/${providerKey}/disconnect`),
    onSuccess: () => {
      toast.success(t('disconnected_toast'))
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
            <p className="text-sm text-muted-foreground">{t('connected_desc')}</p>
            {svc.lastSyncAt && <p className="text-xs text-muted-foreground">{t('last_sync_at', { when: new Date(svc.lastSyncAt).toLocaleString() })}</p>}
            <Button variant="destructive" onClick={() => disconnect.mutate()} disabled={disconnect.isPending} className="w-full">
              {t('common:disconnect')}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="token">{t('bearer_label')}</Label>
              <Input
                id="token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder={t('bearer_placeholder')}
                autoComplete="off"
              />
              <p className="text-xs text-muted-foreground">{t('bearer_hint')}</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => test.mutate()} disabled={test.isPending || !token} className="flex-1">
                {test.isPending ? t('testing') : t('test')}
              </Button>
              <Button onClick={() => connect.mutate()} disabled={connect.isPending || !token} className="flex-1">
                {connect.isPending ? t('connecting') : t('connect')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
