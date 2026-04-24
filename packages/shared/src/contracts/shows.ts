import { z } from 'zod'
import { SHOW_STATUSES, SHOW_KINDS } from '../types/status.js'

export const ShowStatusSchema = z.enum(SHOW_STATUSES)
export const ShowKindSchema = z.enum(SHOW_KINDS)

export const ProviderLinkSchema = z.object({
  key: z.string(),
  displayName: z.string(),
  url: z.string().url(),
})

export const EpisodeProgressSchema = z.object({
  id: z.string().uuid(),
  episodeNumber: z.number().int(),
  title: z.string().nullable(),
  durationSeconds: z.number().int().nullable(),
  airDate: z.string().nullable(), // ISO date string
  watched: z.boolean(),
  watchedAt: z.string().nullable(),
  playheadSeconds: z.number().int(),
  providers: z.array(ProviderLinkSchema),
})

export const SeasonDetailSchema = z.object({
  id: z.string().uuid(),
  seasonNumber: z.number().int(),
  title: z.string().nullable(),
  airDate: z.string().nullable(),
  episodeCount: z.number().int(),
  watchedCount: z.number().int(),
  episodes: z.array(EpisodeProgressSchema),
})

export const ShowListItemSchema = z.object({
  id: z.string().uuid(),
  canonicalTitle: z.string(),
  coverUrl: z.string().nullable(),
  year: z.number().int().nullable(),
  kind: ShowKindSchema,
  genres: z.array(z.string()),
  latestAirDate: z.string().nullable(),
  status: ShowStatusSchema,
  rating: z.number().int().min(1).max(5).nullable(),
  /** Community rating on a 0-10 scale (from TMDB / AniList); null when no external source rated it yet. */
  communityRating: z.number().nullable(),
  favoritedAt: z.string().nullable(),
  queuePosition: z.number().int().nullable(),
  totalEpisodes: z.number().int(),
  watchedEpisodes: z.number().int(),
  lastActivityAt: z.string(),
  providers: z.array(ProviderLinkSchema),
})

export const ShowDetailSchema = ShowListItemSchema.extend({
  description: z.string().nullable(),
  kindOverride: ShowKindSchema.nullable(),
  seasons: z.array(SeasonDetailSchema),
})

export const PatchShowBodySchema = z.object({
  rating: z.number().int().min(1).max(5).nullable().optional(),
  status: z.enum(['removed', 'restore']).optional(),
  favorited: z.boolean().optional(),
  kindOverride: ShowKindSchema.nullable().optional(),
}).strict()

export const PatchEpisodeBodySchema = z.object({
  watched: z.boolean(),
}).strict()

export type ShowListItem = z.infer<typeof ShowListItemSchema>
export type ShowDetail = z.infer<typeof ShowDetailSchema>
export type SeasonDetail = z.infer<typeof SeasonDetailSchema>
export type EpisodeProgress = z.infer<typeof EpisodeProgressSchema>
export type ProviderLink = z.infer<typeof ProviderLinkSchema>
export type PatchShowBody = z.infer<typeof PatchShowBodySchema>
export type PatchEpisodeBody = z.infer<typeof PatchEpisodeBodySchema>
