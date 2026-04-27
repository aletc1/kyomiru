import { Link } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import type { ShowListItem } from '@kyomiru/shared/contracts/shows'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { RatingStars } from '@/components/RatingStars'
import { ProviderLinkButton } from '@/components/ProviderLinkButton'
import { JustWatchButton } from '@/components/JustWatchButton'

interface Props {
  show: ShowListItem
}

export function ShowCard({ show }: Props) {
  const { t } = useTranslation()
  const progress = show.totalEpisodes > 0 ? Math.round((show.watchedEpisodes / show.totalEpisodes) * 100) : 0

  return (
    <div className="group relative">
      <div className="relative overflow-hidden rounded-lg border bg-card transition-all group-hover:shadow-md group-hover:-translate-y-0.5">
        {/* Cover */}
        <div className="aspect-[2/3] relative overflow-hidden bg-muted">
          {show.coverUrl ? (
            <img
              src={show.coverUrl}
              alt={show.canonicalTitle}
              className="h-full w-full object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-4xl">📺</div>
          )}
        </div>
        {/* Info */}
        <div className="p-3 space-y-2">
          <p className="font-medium text-sm leading-tight line-clamp-2">{show.canonicalTitle}</p>
          {show.totalEpisodes > 0 && (
            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {t('eps', { watched: show.watchedEpisodes, total: show.totalEpisodes, count: show.totalEpisodes })}
              </p>
            </div>
          )}
          {show.rating && <RatingStars value={show.rating} size="sm" />}
        </div>
      </div>
      <Link
        to="/show/$showId"
        params={{ showId: show.id }}
        aria-label={show.canonicalTitle}
        className="absolute inset-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      />
      {show.status === 'new_content' && (
        <div className="absolute top-2 left-2 pointer-events-none">
          <Badge variant="new">NEW</Badge>
        </div>
      )}
      {show.status === 'coming_soon' && (
        <div className="absolute top-2 left-2 pointer-events-none">
          <Badge variant="soon">SOON</Badge>
        </div>
      )}
      <div className="absolute top-2 right-2">
        {show.providers.length > 0 ? (
          <ProviderLinkButton
            providers={show.providers}
            kind="show"
            size="icon"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background"
          />
        ) : (
          <JustWatchButton
            title={show.canonicalTitle}
            year={show.year}
            size="icon"
            className="h-8 w-8 bg-background/80 backdrop-blur-sm hover:bg-background"
          />
        )}
      </div>
    </div>
  )
}
