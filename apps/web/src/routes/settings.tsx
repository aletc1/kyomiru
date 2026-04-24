import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { formatRelative } from '@/lib/utils'
import { loadLocale } from '@/i18n'
import type { User } from '@kyomiru/shared/contracts/auth'
import type { ExtensionToken } from '@kyomiru/shared/contracts/ingest'
import { PROVIDER_META } from '@/lib/providers'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { Copy, Trash2, Plus } from 'lucide-react'
import { useExtensionTokens } from '@/hooks/useExtensionTokens'
import i18n from '@/i18n'

const AUTO_LOCALE = 'auto'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { t } = useTranslation('settings')
  const { data: user } = useQuery<User>({ queryKey: Q.me, queryFn: () => api.get<User>('/me') })

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">{t('title')}</h1>
      {user && (
        <Card>
          <CardHeader><CardTitle>{t('account_title')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{user.displayName}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <Button variant="outline" onClick={logout} className="mt-4">{t('sign_out')}</Button>
          </CardContent>
        </Card>
      )}
      {user && <LanguageCard user={user} />}
      <DevicesCard />
    </div>
  )
}

function LanguageCard({ user }: { user: User }) {
  const { t } = useTranslation('settings')
  const queryClient = useQueryClient()

  const LOCALE_OPTIONS = [
    { value: AUTO_LOCALE, label: t('locale_auto') },
    { value: 'en-US', label: t('locale_en') },
    { value: 'ja-JP', label: t('locale_ja') },
    { value: 'es-ES', label: t('locale_es') },
    { value: 'fr-FR', label: t('locale_fr') },
  ]

  const setLocale = useMutation({
    mutationFn: (locale: string | null) => api.patch('/me', { preferredLocale: locale }),
    onSuccess: async (_, locale) => {
      queryClient.invalidateQueries({ queryKey: Q.me })
      queryClient.invalidateQueries({ queryKey: Q.library({}) })
      queryClient.invalidateQueries({ queryKey: ['show'] })
      if (locale && locale !== 'ja-JP') {
        await loadLocale(locale)
      }
      toast.success(t('language_updated'))
    },
    onError: (err) => toast.error(err.message),
  })

  return (
    <Card>
      <CardHeader><CardTitle>{t('language_title')}</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">{t('language_desc')}</p>
        <Label htmlFor="locale-select">{t('preferred_language')}</Label>
        <Select
          value={user.preferredLocale ?? AUTO_LOCALE}
          onValueChange={(v) => setLocale.mutate(v === AUTO_LOCALE ? null : v)}
          disabled={setLocale.isPending}
        >
          <SelectTrigger id="locale-select" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LOCALE_OPTIONS.map((opt) => (
              <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </CardContent>
    </Card>
  )
}

function SyncSummary({ syncsByProvider }: { syncsByProvider?: Record<string, string> }) {
  if (!syncsByProvider || Object.keys(syncsByProvider).length === 0) return null
  const entries = Object.entries(syncsByProvider)
  return (
    <span className="text-xs text-muted-foreground">
      {entries.map(([key, ts], i) => {
        const name = PROVIDER_META[key]?.siteLabel?.split('.')[0] ?? key
        return (
          <span key={key}>
            {i > 0 && ' · '}
            {name} {formatRelative(ts, i18n.language) ?? 'never'}
          </span>
        )
      })}
    </span>
  )
}

function DevicesCard() {
  const { t } = useTranslation('settings')
  const [label, setLabel] = useState('')
  const { tokens, isLoading, create, revoke, justCreated, clearJustCreated } = useExtensionTokens()

  const copyToken = async () => {
    if (!justCreated) return
    await navigator.clipboard.writeText(justCreated.token)
    toast.success(t('token_copied'))
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('devices_title')}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">{t('devices_desc')}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token-label">{t('add_device')}</Label>
            <div className="flex gap-2">
              <Input
                id="token-label"
                placeholder={t('device_placeholder')}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
              />
              <Button
                onClick={() => create.mutate(label, { onSuccess: () => setLabel('') })}
                disabled={!label.trim() || create.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                {create.isPending ? t('creating') : t('create')}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <div className="h-16 rounded bg-muted animate-pulse" />
            ) : (tokens ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('no_devices')}</p>
            ) : (
              (tokens ?? []).map((tok: ExtensionToken) => (
                <div
                  key={tok.id}
                  className="flex items-center gap-2 rounded-md border bg-card/50 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{tok.label}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('added_date', { date: new Date(tok.createdAt).toLocaleDateString() })}
                      {tok.lastUsedAt
                        ? t('last_seen', { when: formatRelative(tok.lastUsedAt, i18n.language) ?? 'just now' })
                        : t('never_connected')}
                    </p>
                    {tok.syncsByProvider && <SyncSummary syncsByProvider={tok.syncsByProvider} />}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(tok.id)}
                    disabled={revoke.isPending}
                    aria-label={t('revoke_device')}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={justCreated !== null} onOpenChange={(open) => !open && clearJustCreated()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('new_token_title')}</DialogTitle>
            <DialogDescription>{t('new_token_desc')}</DialogDescription>
          </DialogHeader>
          {justCreated && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs break-all">
                {justCreated.token}
              </div>
              <Button onClick={copyToken} className="w-full">
                <Copy className="h-4 w-4 mr-2" /> {t('copy_to_clipboard')}
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
