import { z } from 'zod'
import { PROVIDER_KEYS } from '../types/status.js'

export const IngestProviderKeySchema = z.enum(PROVIDER_KEYS)

// Crunchyroll occasionally returns fractional values (e.g. episode 11.5 for
// recap specials, season 2.5 for OVA arcs). Floor to the nearest integer so
// these land on the parent episode/season — collisions are harmless because
// episode_providers still maps the distinct externalId onto the shared row.
const IngestOrdinal = z.number().nonnegative().transform((n) => Math.floor(n))

export const IngestEpisodeSchema = z.object({
  number: IngestOrdinal,
  title: z.string().optional(),
  durationSeconds: z.number().int().nonnegative().optional(),
  airDate: z.string().optional(),
  externalId: z.string().min(1),
})

export const IngestSeasonSchema = z.object({
  number: IngestOrdinal,
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

export const IngestStartBodySchema = z.object({
  trigger: z.enum(['manual', 'cron']).optional(),
  resumeRunId: z.string().uuid().optional(),
}).strict()

export const IngestStartResponseSchema = z.object({
  runId: z.string().uuid(),
  resumed: z.boolean(),
})

export const IngestStartConflictSchema = z.object({
  error: z.literal('run_in_progress'),
  runId: z.string().uuid(),
})

export const IngestChunkBodySchema = IngestBodySchema.extend({
  runId: z.string().uuid(),
}).strict()

export const IngestChunkResponseSchema = z.object({
  runId: z.string().uuid(),
  itemsReceived: z.number().int().nonnegative(),
  itemsIngested: z.number().int().nonnegative(),
  itemsSkipped: z.number().int().nonnegative(),
  itemsNew: z.number().int().nonnegative(),
})

export const IngestFinalizeBodySchema = z.object({
  runId: z.string().uuid(),
}).strict()

export const IngestFinalizeResponseSchema = IngestResponseSchema

export type IngestEpisode = z.infer<typeof IngestEpisodeSchema>
export type IngestSeason = z.infer<typeof IngestSeasonSchema>
export type IngestShow = z.infer<typeof IngestShowSchema>
export type IngestItem = z.infer<typeof IngestItemSchema>
export type IngestBody = z.infer<typeof IngestBodySchema>
export type IngestResponse = z.infer<typeof IngestResponseSchema>
export type IngestStartBody = z.infer<typeof IngestStartBodySchema>
export type IngestStartResponse = z.infer<typeof IngestStartResponseSchema>
export type IngestStartConflict = z.infer<typeof IngestStartConflictSchema>
export type IngestChunkBody = z.infer<typeof IngestChunkBodySchema>
export type IngestChunkResponse = z.infer<typeof IngestChunkResponseSchema>
export type IngestFinalizeBody = z.infer<typeof IngestFinalizeBodySchema>
export type IngestFinalizeResponse = z.infer<typeof IngestFinalizeResponseSchema>

export const IngestResolveBodySchema = z.object({
  externalShowIds: z.array(z.string().min(1)).max(1000),
}).strict()

export const IngestResolveShowSchema = z.object({
  externalShowId: z.string(),
  known: z.boolean(),
  catalogSyncedAt: z.string().datetime().nullable(),
  // Keys are season numbers (stringified); values are the max known episode number.
  // Replaces the old flat maxSeasonNumber/maxEpisodeNumber pair so the extension
  // can check coverage per-season instead of only for the highest season.
  seasonCoverage: z.record(z.string(), z.number().int().nonnegative()),
})

export const IngestResolveResponseSchema = z.object({
  shows: z.array(IngestResolveShowSchema),
})

export type IngestResolveBody = z.infer<typeof IngestResolveBodySchema>
export type IngestResolveShow = z.infer<typeof IngestResolveShowSchema>
export type IngestResolveResponse = z.infer<typeof IngestResolveResponseSchema>

export const ExtensionTokenSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  createdAt: z.string(),
  lastUsedAt: z.string().nullable(),
  syncsByProvider: z.record(z.string(), z.string()).optional(),
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
