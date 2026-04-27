import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Heart, HeartOff, Trash2, RotateCcw, CheckCheck, ListChecks } from 'lucide-react'
import { api } from '@/lib/api'
import { formatRelative } from '@/lib/utils'
import { Q } from '@/lib/queryKeys'
import type { ShowDetail, SeasonDetail, EpisodeProgress, BulkProgressBody } from '@kyomiru/shared/contracts/shows'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { RatingStars } from '@/components/RatingStars'
import { Skeleton } from '@/components/ui/skeleton'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { ProviderLinkButton } from '@/components/ProviderLinkButton'
import { JustWatchButton } from '@/components/JustWatchButton'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import i18n from '@/i18n'

const KIND_OPTIONS = ['anime', 'tv', 'movie'] as const

export const Route = createFileRoute('/show/$showId')({
  component: ShowDetailPage,
})

function ShowDetailPage() {
  const { t } = useTranslation('show')
  const { showId } = Route.useParams()
  const navigate = useNavigate()
  const router = useRouter()
  const queryClient = useQueryClient()

  const handleBack = () => {
    if (window.history.length > 1) {
      router.history.back()
    } else {
      void navigate({ to: '/library' })
    }
  }

  const { data: show, isLoading } = useQuery<ShowDetail>({
    queryKey: Q.show(showId),
    queryFn: () => api.get<ShowDetail>(`/shows/${showId}`),
    staleTime: 5 * 60 * 1000,
  })

  const invalidateShowQueries = () => {
    queryClient.invalidateQueries({ queryKey: Q.show(showId) })
    queryClient.invalidateQueries({ queryKey: Q.library({}) })
    queryClient.invalidateQueries({ queryKey: Q.newContentCount })
    queryClient.invalidateQueries({ queryKey: Q.comingSoonCount })
    queryClient.invalidateQueries({ queryKey: Q.queue })
  }

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.patch(`/shows/${showId}`, body),
    onSuccess: invalidateShowQueries,
    onError: (err) => toast.error(err.message),
  })

  const toggleEpisode = useMutation({
    mutationFn: ({ episodeId, watched }: { episodeId: string; watched: boolean }) =>
      api.patch(`/shows/${showId}/episodes/${episodeId}`, { watched }),
    onSuccess: invalidateShowQueries,
    onError: (err) => toast.error(err.message),
  })

  const bulkProgress = useMutation({
    mutationFn: (body: BulkProgressBody) =>
      api.post(`/shows/${showId}/episodes/bulk-progress`, body),
    onSuccess: invalidateShowQueries,
    onError: (err) => toast.error(err.message),
  })

  if (isLoading) return <ShowDetailSkeleton />
  if (!show) return <div className="py-24 text-center text-muted-foreground">{t('not_found')}</div>

  const isFavorited = !!show.favoritedAt
  const isRemoved = show.status === 'removed'
  const isWatched = show.status === 'watched'

  // Mirrors the backend's airedEpisodesFilter (NULL or air_date <= today).
  // Used to size the bulk-mark UI; the server is still authoritative.
  const today = todayLocalDateString()
  const isAired = (ep: EpisodeProgress) => !ep.airDate || ep.airDate <= today
  const seasonAiredUnwatched = (s: SeasonDetail) =>
    s.episodes.filter((ep) => isAired(ep) && !ep.watched).length
  const showAiredUnwatched = show.seasons.reduce((sum, s) => sum + seasonAiredUnwatched(s), 0)

  const kindLabel = (k: string) => {
    if (k === 'anime') return t('kind_anime')
    if (k === 'tv') return t('kind_tv')
    if (k === 'movie') return t('kind_movie')
    return k
  }

  const actionsContent = (
    <>
      {!isWatched && (
        <Button
          variant={isFavorited ? 'default' : 'outline'}
          size="sm"
          className="w-full sm:w-auto"
          onClick={() => patch.mutate({ favorited: !isFavorited })}
          disabled={patch.isPending || isRemoved}
        >
          {isFavorited
            ? <><HeartOff className="h-4 w-4 mr-1.5" />{t('remove_from_queue')}</>
            : <><Heart className="h-4 w-4 mr-1.5" />{t('add_to_queue')}</>}
        </Button>
      )}
      <ProviderLinkButton providers={show.providers} kind="show" size="sm" showLabel className="w-full sm:w-auto" />
      <JustWatchButton title={show.canonicalTitle} year={show.year} size="sm" showLabel className="w-full sm:w-auto" />
      {!isWatched && !isRemoved && showAiredUnwatched > 0 && (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto" disabled={bulkProgress.isPending}>
              <ListChecks className="h-4 w-4 mr-1.5" /> {t('mark_show_viewed')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('mark_show_dialog_title')}</DialogTitle>
              <DialogDescription>
                {t('mark_show_dialog_desc', { count: showAiredUnwatched })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 justify-end">
              <DialogClose asChild>
                <Button variant="outline">{t('common:cancel')}</Button>
              </DialogClose>
              <DialogClose asChild>
                <Button onClick={() => bulkProgress.mutate({ watched: true })}>{t('common:confirm')}</Button>
              </DialogClose>
            </div>
          </DialogContent>
        </Dialog>
      )}
      {isRemoved ? (
        <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={() => patch.mutate({ status: 'restore' })} disabled={patch.isPending}>
          <RotateCcw className="h-4 w-4 mr-1.5" /> {t('restore')}
        </Button>
      ) : (
        <Dialog>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="w-full sm:w-auto" disabled={patch.isPending}>
              <Trash2 className="h-4 w-4 mr-1.5" /> {t('remove')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('remove_dialog_title')}</DialogTitle>
              <DialogDescription>
                {t('remove_dialog_desc', { title: show.canonicalTitle })}
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-3 justify-end">
              <Button variant="destructive" onClick={() => patch.mutate({ status: 'removed' })}>{t('remove')}</Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={handleBack}>
        <ArrowLeft className="h-4 w-4 mr-2" /> {t('common:back')}
      </Button>

      <div className="flex gap-6">
        {/* Cover */}
        <div className="shrink-0 w-36 md:w-48">
          <div className="aspect-[2/3] rounded-xl overflow-hidden bg-muted">
            {show.coverUrl ? (
              <img src={show.coverUrl} alt={show.canonicalTitle} className="w-full h-full object-cover" />
            ) : (
              <div className="flex items-center justify-center h-full text-5xl">📺</div>
            )}
          </div>
        </div>
        {/* Meta */}
        <div className="flex-1 min-w-0 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="secondary" size="sm" className="h-6 px-2 text-xs font-medium rounded-full">
                  {kindLabel(show.kind)}
                  {show.kindOverride && <span className="ml-1 opacity-60">*</span>}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {KIND_OPTIONS.map((k) => (
                  <DropdownMenuItem
                    key={k}
                    onClick={() => patch.mutate({ kindOverride: k === show.kind && !show.kindOverride ? null : k })}
                    className={show.kind === k ? 'font-medium' : ''}
                  >
                    {kindLabel(k)}
                    {show.kind === k && !show.kindOverride && ` ${t('kind_auto')}`}
                  </DropdownMenuItem>
                ))}
                {show.kindOverride && (
                  <DropdownMenuItem onClick={() => patch.mutate({ kindOverride: null })}>
                    {t('kind_reset_auto')}
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {show.year && <span className="text-sm text-muted-foreground">{show.year}</span>}
            {show.status === 'new_content' && <Badge variant="new">NEW</Badge>}
            {show.status === 'coming_soon' && <Badge variant="soon">SOON</Badge>}
          </div>
          <h1 className="text-2xl font-bold leading-tight">{show.canonicalTitle}</h1>
          {show.genres.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {show.genres.map((g) => <Badge key={g} variant="outline" className="text-xs">{g}</Badge>)}
            </div>
          )}
          {show.latestAirDate && (
            <p className="text-sm text-muted-foreground">{t('latest_episode')} {show.latestAirDate}</p>
          )}
          <div className="flex items-center gap-3">
            <RatingStars
              value={show.rating}
              onChange={(r) => patch.mutate({ rating: r })}
            />
            {show.communityRating !== null && (
              <span className="text-xs text-muted-foreground tabular-nums">
                {t('tmdb_rating', { value: show.communityRating.toFixed(1) })}
              </span>
            )}
          </div>
          {/* Desktop actions: inside the meta column (original layout) */}
          <div className="hidden sm:flex sm:flex-wrap gap-2 pt-1">
            {actionsContent}
          </div>
        </div>
      </div>

      {/* Mobile actions: full-width below the poster row */}
      <div className="flex flex-col gap-2 sm:hidden">
        {actionsContent}
      </div>

      {show.description && (
        <p className="text-sm text-muted-foreground leading-relaxed">{show.description}</p>
      )}

      {/* Progress summary */}
      {show.totalEpisodes > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCheck className="h-4 w-4" />
          {t('episodes_watched', { watched: show.watchedEpisodes, total: show.totalEpisodes })}
        </div>
      )}

      {/* Seasons */}
      {show.seasons.length > 0 && (
        <Accordion type="multiple" className="w-full">
          {show.seasons.map((season) => (
            <AccordionItem key={season.id} value={season.id}>
              <AccordionTrigger>
                <span className="flex items-center gap-3">
                  {t('season_label', { n: season.seasonNumber })}
                  {season.title && season.title !== t('season_label', { n: season.seasonNumber }) && season.title !== `Season ${season.seasonNumber}` && (
                    <span className="font-normal text-muted-foreground">— {season.title}</span>
                  )}
                  <Badge variant="secondary" className="ml-2 text-xs">
                    {season.watchedCount}/{season.episodeCount}
                  </Badge>
                </span>
              </AccordionTrigger>
              <AccordionContent>
                {(() => {
                  const airedUnwatched = seasonAiredUnwatched(season)
                  if (airedUnwatched === 0) return null
                  return (
                  <div className="px-2 pb-2">
                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="ghost" size="sm" className="text-xs text-muted-foreground" disabled={bulkProgress.isPending}>
                          <ListChecks className="h-3.5 w-3.5 mr-1.5" /> {t('mark_season_viewed')}
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>{t('mark_season_dialog_title', { n: season.seasonNumber })}</DialogTitle>
                          <DialogDescription>
                            {t('mark_season_dialog_desc', { count: airedUnwatched })}
                          </DialogDescription>
                        </DialogHeader>
                        <div className="flex gap-3 justify-end">
                          <DialogClose asChild>
                            <Button variant="outline">{t('common:cancel')}</Button>
                          </DialogClose>
                          <DialogClose asChild>
                            <Button onClick={() => bulkProgress.mutate({ watched: true, seasonId: season.id })}>
                              {t('common:confirm')}
                            </Button>
                          </DialogClose>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                  )
                })()}
                <div className="space-y-1">
                  {season.episodes.map((ep) => (
                    <div key={ep.id} className="flex items-center gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 text-sm">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        aria-label={ep.watched ? t('mark_not_viewed') : t('mark_viewed')}
                        disabled={toggleEpisode.isPending}
                        onClick={() => toggleEpisode.mutate({ episodeId: ep.id, watched: !ep.watched })}
                      >
                        <CheckCheck className={`h-4 w-4 ${ep.watched ? 'text-primary' : 'text-muted-foreground/30'}`} />
                      </Button>
                      <span className="text-muted-foreground w-8 shrink-0">{ep.episodeNumber}.</span>
                      <span className="flex-1 truncate">{ep.title ?? t('episode_label', { n: ep.episodeNumber })}</span>
                      {ep.watchedAt && (
                        <span
                          className="text-xs text-muted-foreground shrink-0 tabular-nums hidden sm:inline"
                          title={new Date(ep.watchedAt).toLocaleString()}
                        >
                          {formatRelative(ep.watchedAt, i18n.language)}
                        </span>
                      )}
                      {ep.durationSeconds && (
                        <span className="text-xs text-muted-foreground shrink-0">
                          {Math.floor(ep.durationSeconds / 60)}m
                        </span>
                      )}
                      <ProviderLinkButton
                        providers={ep.providers.length > 0 ? ep.providers : show.providers}
                        kind={ep.providers.length > 0 ? 'episode' : 'show'}
                        size="icon"
                        className="h-7 w-7 shrink-0"
                      />
                    </div>
                  ))}
                </div>
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      )}
    </div>
  )
}

function todayLocalDateString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function ShowDetailSkeleton() {
  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Skeleton className="h-9 w-20" />
      <div className="flex gap-6">
        <Skeleton className="w-48 aspect-[2/3] rounded-xl" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-6 w-32" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-9 w-40" />
        </div>
      </div>
    </div>
  )
}
