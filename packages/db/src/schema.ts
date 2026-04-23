import {
  pgTable, pgEnum, uuid, text, integer, boolean,
  timestamp, jsonb, smallint, date, numeric, index,
  uniqueIndex, AnyPgColumn,
} from 'drizzle-orm/pg-core'
import { sql } from 'drizzle-orm'

// ─── Enums ───────────────────────────────────────────────────────────────────
export const showStatusEnum = pgEnum('show_status', ['in_progress', 'new_content', 'watched', 'removed'])
export const serviceStatusEnum = pgEnum('service_status', ['connected', 'disconnected', 'error'])
export const syncStatusEnum = pgEnum('sync_status', ['running', 'success', 'partial', 'error'])
export const syncTriggerEnum = pgEnum('sync_trigger', ['manual', 'cron'])
export const matchSourceEnum = pgEnum('match_source', ['provider_primary', 'anilist_match', 'tmdb_match', 'manual'])
export const showKindEnum = pgEnum('show_kind', ['anime', 'tv', 'movie'])

// ─── Global: providers ───────────────────────────────────────────────────────
export const providers = pgTable('providers', {
  key: text('key').primaryKey(),
  displayName: text('display_name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  kind: text('kind').notNull().default('general'),
})

// ─── User accounts ────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  googleSub: text('google_sub').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  avatarUrl: text('avatar_url'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
})

// ─── User <> provider credentials ────────────────────────────────────────────
export const userServices = pgTable('user_services', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key, { onDelete: 'restrict' }),
  status: serviceStatusEnum('status').notNull().default('disconnected'),
  encryptedSecret: text('encrypted_secret'),  // base64 ciphertext
  secretNonce: text('secret_nonce'),           // base64 nonce
  lastTestedAt: timestamp('last_tested_at', { withTimezone: true }),
  lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
  lastError: text('last_error'),
  lastCursor: jsonb('last_cursor'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  { pk: { columns: [t.userId, t.providerKey] } },
  index('user_services_user_idx').on(t.userId),
])

// ─── Global: shows ────────────────────────────────────────────────────────────
export const shows = pgTable('shows', {
  id: uuid('id').primaryKey().defaultRandom(),
  canonicalTitle: text('canonical_title').notNull(),
  titleNormalized: text('title_normalized').notNull(),
  description: text('description'),
  coverUrl: text('cover_url'),
  year: integer('year'),
  kind: showKindEnum('kind').notNull().default('tv'),
  genres: text('genres').array().notNull().default(sql`'{}'::text[]`),
  latestAirDate: date('latest_air_date'),
  tmdbId: integer('tmdb_id'),
  anilistId: integer('anilist_id'),
  rating: numeric('rating', { precision: 3, scale: 1 }),
  enrichedAt: timestamp('enriched_at', { withTimezone: true }),
  enrichmentAttempts: integer('enrichment_attempts').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ─── Global: show <> provider mapping ────────────────────────────────────────
export const showProviders = pgTable('show_providers', {
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key, { onDelete: 'restrict' }),
  externalId: text('external_id').notNull(),
  matchSource: matchSourceEnum('match_source').notNull().default('provider_primary'),
  matchConfidence: numeric('match_confidence', { precision: 4, scale: 3 }),
  rawMetadata: jsonb('raw_metadata'),
  catalogSyncedAt: timestamp('catalog_synced_at', { withTimezone: true }),
}, (t) => [
  { pk: { columns: [t.showId, t.providerKey, t.externalId] } },
  uniqueIndex('show_providers_external_idx').on(t.providerKey, t.externalId),
])

// ─── Global: seasons ─────────────────────────────────────────────────────────
export const seasons = pgTable('seasons', {
  id: uuid('id').primaryKey().defaultRandom(),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  seasonNumber: integer('season_number').notNull(),
  title: text('title'),
  airDate: date('air_date'),
  episodeCount: integer('episode_count').notNull().default(0),
}, (t) => [
  uniqueIndex('seasons_show_number_idx').on(t.showId, t.seasonNumber),
  index('seasons_show_idx').on(t.showId),
])

// ─── Global: episodes ─────────────────────────────────────────────────────────
export const episodes = pgTable('episodes', {
  id: uuid('id').primaryKey().defaultRandom(),
  seasonId: uuid('season_id').notNull().references(() => seasons.id, { onDelete: 'cascade' }),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  episodeNumber: integer('episode_number').notNull(),
  title: text('title'),
  durationSeconds: integer('duration_seconds'),
  airDate: date('air_date'),
}, (t) => [
  uniqueIndex('episodes_season_number_idx').on(t.seasonId, t.episodeNumber),
  index('episodes_show_idx').on(t.showId),
  index('episodes_air_date_idx').on(t.airDate),
])

// ─── Global: episode <> provider mapping ─────────────────────────────────────
export const episodeProviders = pgTable('episode_providers', {
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key),
  externalId: text('external_id').notNull(),
}, (t) => [
  { pk: { columns: [t.episodeId, t.providerKey] } },
  uniqueIndex('episode_providers_external_idx').on(t.providerKey, t.externalId),
])

// ─── User: raw watch events ───────────────────────────────────────────────────
export const watchEvents = pgTable('watch_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key),
  externalItemId: text('external_item_id').notNull(),
  watchedAt: timestamp('watched_at', { withTimezone: true }).notNull(),
  playheadSeconds: integer('playhead_seconds'),
  durationSeconds: integer('duration_seconds'),
  fullyWatched: boolean('fully_watched'),
  raw: jsonb('raw').notNull(),
  ingestedAt: timestamp('ingested_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('watch_events_natural_key').on(t.userId, t.providerKey, t.externalItemId, t.watchedAt),
  index('watch_events_user_time_idx').on(t.userId, t.watchedAt),
])

// ─── User: rolled-up episode progress ────────────────────────────────────────
export const userEpisodeProgress = pgTable('user_episode_progress', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  episodeId: uuid('episode_id').notNull().references(() => episodes.id, { onDelete: 'cascade' }),
  playheadSeconds: integer('playhead_seconds').notNull().default(0),
  watched: boolean('watched').notNull().default(false),
  watchedAt: timestamp('watched_at', { withTimezone: true }),
  lastEventAt: timestamp('last_event_at', { withTimezone: true }).notNull(),
}, (t) => [
  { pk: { columns: [t.userId, t.episodeId] } },
  index('uep_user_watched_idx').on(t.userId, t.watched),
])

// ─── User: derived show state ─────────────────────────────────────────────────
export const userShowState = pgTable('user_show_state', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  showId: uuid('show_id').notNull().references(() => shows.id, { onDelete: 'cascade' }),
  status: showStatusEnum('status').notNull(),
  prevStatus: showStatusEnum('prev_status'),
  rating: smallint('rating'),
  favoritedAt: timestamp('favorited_at', { withTimezone: true }),
  queuePosition: integer('queue_position'),
  totalEpisodes: integer('total_episodes').notNull().default(0),
  watchedEpisodes: integer('watched_episodes').notNull().default(0),
  lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  { pk: { columns: [t.userId, t.showId] } },
  index('uss_user_status_idx').on(t.userId, t.status),
  index('uss_user_activity_idx').on(t.userId, t.lastActivityAt),
  index('uss_user_favorited_idx').on(t.userId, t.queuePosition),
])

// ─── User: sync audit ─────────────────────────────────────────────────────────
export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key),
  trigger: syncTriggerEnum('trigger').notNull(),
  status: syncStatusEnum('status').notNull().default('running'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  itemsIngested: integer('items_ingested').notNull().default(0),
  itemsNew: integer('items_new').notNull().default(0),
  cursorBefore: jsonb('cursor_before'),
  cursorAfter: jsonb('cursor_after'),
  errors: jsonb('errors'),
}, (t) => [
  index('sync_runs_user_time_idx').on(t.userId, t.startedAt),
])

// ─── User: content hash fallback delta ───────────────────────────────────────
export const contentHashes = pgTable('content_hashes', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  providerKey: text('provider_key').notNull().references(() => providers.key),
  scope: text('scope').notNull(),
  hash: text('hash').notNull(),
  computedAt: timestamp('computed_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  { pk: { columns: [t.userId, t.providerKey, t.scope] } },
])

// ─── User: Chrome extension API tokens ───────────────────────────────────────
export const extensionTokens = pgTable('extension_tokens', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull().unique(),
  label: text('label').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, (t) => [
  index('extension_tokens_user_idx').on(t.userId),
])
