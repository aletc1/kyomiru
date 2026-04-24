import { cn } from '@/lib/utils'

interface LogoProps {
  size?: 'sm' | 'md' | 'lg'
  showWordmark?: boolean
  className?: string
}

const sizeMap = {
  sm: 'h-6 w-6',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
}

const textSizeMap = {
  sm: 'text-base',
  md: 'text-lg',
  lg: 'text-3xl',
}

export function Logo({ size = 'md', showWordmark = true, className }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2', className)}>
      <img
        src="/icons/logo-master.png"
        alt={showWordmark ? '' : 'Kyomiru'}
        className={cn('object-contain', sizeMap[size])}
      />
      {showWordmark && (
        <span className={cn('font-bold tracking-tight', textSizeMap[size])}>Kyomiru</span>
      )}
    </span>
  )
}
