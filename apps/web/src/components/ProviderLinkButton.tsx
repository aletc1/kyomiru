import { ExternalLink, Play } from 'lucide-react'
import type { ProviderLink } from '@kyomiru/shared/contracts/shows'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'

interface Props {
  providers: ProviderLink[]
  kind: 'show' | 'episode'
  size?: 'sm' | 'icon'
  showLabel?: boolean
  className?: string
}

export function ProviderLinkButton({
  providers,
  kind,
  size = 'icon',
  showLabel = false,
  className,
}: Props) {
  if (providers.length === 0) return null

  const Icon = kind === 'episode' ? Play : ExternalLink
  const verb = kind === 'episode' ? 'Play' : 'Open'

  // Stop propagation so clicks inside wrapping <Link> components don't navigate.
  const stopPropagation = (e: React.MouseEvent | React.PointerEvent) => e.stopPropagation()

  if (providers.length === 1) {
    const [p] = providers
    if (!p) return null
    const label = `${verb} on ${p.displayName}`
    return (
      <Button
        asChild
        variant={size === 'icon' ? 'secondary' : 'outline'}
        size={size}
        className={className}
        onClick={stopPropagation}
      >
        <a
          href={p.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" />
          {showLabel && <span>{label}</span>}
        </a>
      </Button>
    )
  }

  const label = `${verb} on…`
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild onClick={stopPropagation} onPointerDown={stopPropagation}>
        <Button
          variant={size === 'icon' ? 'secondary' : 'outline'}
          size={size}
          className={cn(className)}
          aria-label={label}
          title={label}
        >
          <Icon className="h-4 w-4" />
          {showLabel && <span>{label}</span>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={stopPropagation}>
        {providers.map((p) => (
          <DropdownMenuItem key={p.key} asChild>
            <a href={p.url} target="_blank" rel="noopener noreferrer">
              <Icon className="h-4 w-4" />
              {verb} on {p.displayName}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
