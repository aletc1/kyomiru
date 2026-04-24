import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelative(iso: string | null | undefined, locale?: string): string | null {
  if (!iso) return null
  const d = new Date(iso)
  const diffMs = Date.now() - d.getTime()
  const diffSecs = Math.round(diffMs / 1000)

  const rtf = new Intl.RelativeTimeFormat(locale ?? 'en-US', { numeric: 'auto' })

  if (diffSecs < 60) return rtf.format(-diffSecs, 'second')
  const mins = Math.round(diffSecs / 60)
  if (mins < 60) return rtf.format(-mins, 'minute')
  const hours = Math.round(mins / 60)
  if (hours < 24) return rtf.format(-hours, 'hour')
  const days = Math.round(hours / 24)
  if (days < 30) return rtf.format(-days, 'day')
  const months = Math.round(days / 30)
  if (months < 12) return rtf.format(-months, 'month')
  const years = Math.round(days / 365)
  return rtf.format(-years, 'year')
}
