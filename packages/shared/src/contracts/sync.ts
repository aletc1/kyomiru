import { z } from 'zod'
import { PROVIDER_KEYS, SYNC_STATUSES, SYNC_TRIGGERS } from '../types/status.js'

export const SyncBodySchema = z.object({
  provider: z.enum(PROVIDER_KEYS).optional(),
}).strict()

export const SyncRunSchema = z.object({
  id: z.string().uuid(),
  providerKey: z.enum(PROVIDER_KEYS),
  trigger: z.enum(SYNC_TRIGGERS),
  status: z.enum(SYNC_STATUSES),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  itemsIngested: z.number().int(),
  itemsNew: z.number().int(),
  errors: z.array(z.object({ step: z.string(), message: z.string() })).nullable(),
})

export const SyncResponseSchema = z.object({
  runIds: z.array(z.string().uuid()),
})

export type SyncBody = z.infer<typeof SyncBodySchema>
export type SyncRun = z.infer<typeof SyncRunSchema>
export type SyncResponse = z.infer<typeof SyncResponseSchema>
