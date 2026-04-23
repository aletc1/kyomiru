import { z } from 'zod'
import { PROVIDER_KEYS } from '../types/status.js'

export const IngestProviderKeySchema = z.enum(PROVIDER_KEYS)

export const IngestEpisodeSchema = z.object({
  number: z.number().int().nonnegative(),
  title: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  airDate: z.string().optional(),
  externalId: z.string().min(1),
})

export const IngestSeasonSchema = z.object({
  number: z.number().int().nonnegative(),
  title: z.string().optional(),
  airDate: z.string().optional(),
  episodes: z.array(IngestEpisodeSchema).max(2000),
})

export const IngestShowSchema = z.object({
  externalId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  coverUrl: z.string().optional(),
  year: z.number().int().optional(),
  kind: z.enum(['anime', 'tv', 'movie']).optional(),
  seasons: z.array(IngestSeasonSchema).max(100),
})

export const IngestItemSchema = z.object({
  externalItemId: z.string().min(1),
  externalShowId: z.string().optional(),
  externalSeasonId: z.string().optional(),
  watchedAt: z.string().datetime(),
  playheadSeconds: z.number().int().nonnegative().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  fullyWatched: z.boolean().optional(),
  raw: z.unknown().optional(),
})

export const IngestBodySchema = z.object({
  items: z.array(IngestItemSchema).max(5000),
  shows: z.array(IngestShowSchema).max(500),
}).strict()

export const IngestResponseSchema = z.object({
  runId: z.string().uuid(),
  itemsIngested: z.number().int().nonnegative(),
  itemsNew: z.number().int().nonnegative(),
})

export type IngestEpisode = z.infer<typeof IngestEpisodeSchema>
export type IngestSeason = z.infer<typeof IngestSeasonSchema>
export type IngestShow = z.infer<typeof IngestShowSchema>
export type IngestItem = z.infer<typeof IngestItemSchema>
export type IngestBody = z.infer<typeof IngestBodySchema>
export type IngestResponse = z.infer<typeof IngestResponseSchema>

export const ExtensionTokenSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
})

export const CreateExtensionTokenBodySchema = z.object({
  label: z.string().min(1).max(64),
}).strict()

export const CreateExtensionTokenResponseSchema = ExtensionTokenSchema.extend({
  token: z.string(),
})

export type ExtensionToken = z.infer<typeof ExtensionTokenSchema>
export type CreateExtensionTokenBody = z.infer<typeof CreateExtensionTokenBodySchema>
export type CreateExtensionTokenResponse = z.infer<typeof CreateExtensionTokenResponseSchema>
