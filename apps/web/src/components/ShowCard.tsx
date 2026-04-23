import { Link } from '@tanstack/react-router'
import type { ShowListItem } from '@kyomiru/shared/contracts/shows'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { RatingStars } from '@/components/RatingStars'

interface Props {
  show: ShowListItem
}

export function ShowCard({ show }: Props) {
  const progress = show.totalEpisodes > 0 ? Math.round((show.watchedEpisodes / show.totalEpisodes) * 100) : 0

  return (
    <Link to="/show/$showId" params={{ showId: show.id }} className="group block">
      <div className="relative overflow-hidden rounded-lg border bg-card transition-all hover:shadow-md hover:-translate-y-0.5">
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
          {show.status === 'new_content' && (
            <div className="absolute top-2 left-2">
              <Badge variant="new">NEW</Badge>
            </div>
          )}
        </div>
        {/* Info */}
        <div className="p-3 space-y-2">
          <p className="font-medium text-sm leading-tight line-clamp-2">{show.canonicalTitle}</p>
          {show.totalEpisodes > 0 && (
            <div className="space-y-1">
              <Progress value={progress} className="h-1.5" />
              <p className="text-xs text-muted-foreground">
                {show.watchedEpisodes}/{show.totalEpisodes} eps
              </p>
            </div>
          )}
          {show.rating && <RatingStars value={show.rating} size="sm" />}
        </div>
      </div>
    </Link>
  )
}
