import { z } from 'zod'
import { ShowListItemSchema } from './shows.js'
import { SHOW_STATUSES, SORT_OPTIONS, GROUP_OPTIONS } from '../types/status.js'

export const LibraryQuerySchema = z.object({
  q: z.string().optional(),
  status: z.enum(SHOW_STATUSES).optional(),
  sort: z.enum(SORT_OPTIONS).optional().default('recent_activity'),
  group: z.enum(GROUP_OPTIONS).optional().default('none'),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(48),
})

export const LibraryPageInfoSchema = z.object({
  nextCursor: z.string().nullable(),
  total: z.number().int(),
})

export const LibraryResponseSchema = z.object({
  items: z.array(ShowListItemSchema),
  pageInfo: LibraryPageInfoSchema,
})

export type LibraryQuery = z.infer<typeof LibraryQuerySchema>
export type LibraryResponse = z.infer<typeof LibraryResponseSchema>
