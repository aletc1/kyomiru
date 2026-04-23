import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  value: number | null
  onChange?: (v: number) => void
  size?: 'sm' | 'md'
}

export function RatingStars({ value, onChange, size = 'md' }: Props) {
  const sz = size === 'sm' ? 'h-3 w-3' : 'h-5 w-5'
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          onClick={() => onChange?.(n)}
          disabled={!onChange}
          className={cn('transition-colors', onChange ? 'cursor-pointer' : 'cursor-default')}
          aria-label={`Rate ${n} star${n !== 1 ? 's' : ''}`}
        >
          <Star
            className={cn(sz, n <= (value ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground')}
          />
        </button>
      ))}
    </div>
  )
}
