import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import type { ExtensionToken, CreateExtensionTokenResponse } from '@kyomiru/shared/contracts/ingest'

export function useExtensionTokens() {
  const queryClient = useQueryClient()
  const [justCreated, setJustCreated] = useState<CreateExtensionTokenResponse | null>(null)

  const { data: tokens, isLoading } = useQuery<ExtensionToken[]>({
    queryKey: Q.extensionTokens,
    queryFn: () => api.get<ExtensionToken[]>('/extension/tokens'),
  })

  const create = useMutation({
    mutationFn: (label: string) =>
      api.post<CreateExtensionTokenResponse>('/extension/tokens', { label }),
    onSuccess: (created) => {
      setJustCreated(created)
      queryClient.invalidateQueries({ queryKey: Q.extensionTokens })
    },
    onError: (err) => toast.error(err.message),
  })

  const revoke = useMutation({
    mutationFn: (id: string) =>
      fetch(`/api/extension/tokens/${id}`, { method: 'DELETE', credentials: 'include' }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text().catch(() => `HTTP ${r.status}`))
      }),
    onSuccess: () => {
      toast.success('Device revoked')
      queryClient.invalidateQueries({ queryKey: Q.extensionTokens })
    },
    onError: (err) => toast.error(err.message),
  })

  const clearJustCreated = () => setJustCreated(null)

  return { tokens, isLoading, create, revoke, justCreated, clearJustCreated }
}
