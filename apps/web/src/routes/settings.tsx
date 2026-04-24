import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { formatRelative } from '@/lib/utils'
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
import { Copy, Trash2, Plus } from 'lucide-react'
import { useExtensionTokens } from '@/hooks/useExtensionTokens'

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
})

function SettingsPage() {
  const { data: user } = useQuery<User>({ queryKey: Q.me, queryFn: () => api.get<User>('/me') })

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-2xl font-bold">Settings</h1>
      {user && (
        <Card>
          <CardHeader><CardTitle>Account</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            <p className="text-sm font-medium">{user.displayName}</p>
            <p className="text-sm text-muted-foreground">{user.email}</p>
            <Button variant="outline" onClick={logout} className="mt-4">Sign out</Button>
          </CardContent>
        </Card>
      )}
      <DevicesCard />
    </div>
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
            {name} {formatRelative(ts) ?? 'never'}
          </span>
        )
      })}
    </span>
  )
}

function DevicesCard() {
  const [label, setLabel] = useState('')
  const { tokens, isLoading, create, revoke, justCreated, clearJustCreated } = useExtensionTokens()

  const copyToken = async () => {
    if (!justCreated) return
    await navigator.clipboard.writeText(justCreated.token)
    toast.success('Token copied to clipboard')
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Devices</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Each device running the Kyomiru Chrome extension needs its own token.
            </p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="token-label">Add a device</Label>
            <div className="flex gap-2">
              <Input
                id="token-label"
                placeholder="e.g. Personal laptop"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={64}
              />
              <Button
                onClick={() => create.mutate(label, { onSuccess: () => setLabel('') })}
                disabled={!label.trim() || create.isPending}
              >
                <Plus className="h-4 w-4 mr-1" />
                {create.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {isLoading ? (
              <div className="h-16 rounded bg-muted animate-pulse" />
            ) : (tokens ?? []).length === 0 ? (
              <p className="text-xs text-muted-foreground">No devices yet.</p>
            ) : (
              (tokens ?? []).map((t: ExtensionToken) => (
                <div
                  key={t.id}
                  className="flex items-center gap-2 rounded-md border bg-card/50 px-3 py-2"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{t.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Added {new Date(t.createdAt).toLocaleDateString()}
                      {t.lastUsedAt ? ` · last seen ${formatRelative(t.lastUsedAt) ?? 'just now'}` : ' · never connected'}
                    </p>
                    {t.syncsByProvider && <SyncSummary syncsByProvider={t.syncsByProvider} />}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => revoke.mutate(t.id)}
                    disabled={revoke.isPending}
                    aria-label="Revoke device"
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
            <DialogTitle>Your new extension token</DialogTitle>
            <DialogDescription>
              Copy this now — you won't be able to see it again. Paste it into the Kyomiru Chrome extension.
            </DialogDescription>
          </DialogHeader>
          {justCreated && (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/50 p-3 font-mono text-xs break-all">
                {justCreated.token}
              </div>
              <Button onClick={copyToken} className="w-full">
                <Copy className="h-4 w-4 mr-2" /> Copy to clipboard
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
