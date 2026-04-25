import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { justWatchSearchUrl } from '@/lib/justwatch'

// Generic play-triangle glyph used as the icon-only affordance. The official
// JustWatch logo (public/justwatch-wordmark.svg) is a wordmark, so it cannot be
// rendered legibly at icon sizes — the labeled button uses the wordmark image
// instead.
function PlayTriangle({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={cn('h-4 w-4', className)}
    >
      <path d="M6 4.5L20 12L6 19.5V4.5Z" />
    </svg>
  )
}

interface Props {
  title: string
  year?: number | null
  size?: 'sm' | 'icon'
  showLabel?: boolean
  className?: string
}

export function JustWatchButton({ title, year, size = 'icon', showLabel = false, className }: Props) {
  const { t, i18n } = useTranslation()
  const url = justWatchSearchUrl({ title, uiLocale: i18n.language, ...(year != null ? { year } : {}) })
  const label = t('open_in_justwatch')

  const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()

  return (
    <Button
      asChild
      variant={size === 'icon' ? 'secondary' : 'outline'}
      size={size}
      className={cn(size === 'icon' && 'text-[#fadc41] hover:text-[#fadc41]', className)}
      onClick={stopPropagation}
    >
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        title={label}
      >
        {showLabel ? (
          <img src="/justwatch-wordmark.svg" alt="JustWatch" className="h-4 w-auto" />
        ) : (
          <PlayTriangle />
        )}
      </a>
    </Button>
  )
}
