import { useState } from 'react'
import { Github, Menu, X } from 'lucide-react'
import { Button } from './ui/button'

const NAV_LINKS = [
  { label: 'Features', href: '#features' },
  { label: 'How it works', href: '#how' },
  { label: 'Providers', href: '#providers' },
  { label: 'FAQ', href: '#faq' },
]

export function Nav() {
  const [open, setOpen] = useState(false)

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/40 backdrop-blur-md bg-background/60">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <a href="#" className="flex items-center gap-2.5 shrink-0">
          <img src="/logo-master.png" alt="Kyomiru" className="h-8 w-8 rounded-lg" />
          <span className="font-semibold text-foreground tracking-tight">Kyomiru</span>
        </a>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-6">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
        </nav>

        {/* Desktop right actions */}
        <div className="hidden md:flex items-center gap-2">
          <a
            href="https://github.com/aletc1/kyomiru"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:text-foreground hover:bg-secondary"
          >
            <Github className="h-5 w-5" />
          </a>
          <Button asChild size="sm">
            <a href="https://kyomiru.app" target="_blank" rel="noopener noreferrer">
              Begin
            </a>
          </Button>
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
      </div>

      {/* Mobile menu */}
      {open && (
        <div className="md:hidden border-t border-border/40 bg-background/95 backdrop-blur-md px-4 pb-4 pt-2">
          <nav className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className="rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
              >
                {link.label}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
            <a
              href="https://github.com/aletc1/kyomiru"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <Button asChild size="sm" className="ml-auto">
              <a href="https://kyomiru.app" target="_blank" rel="noopener noreferrer">
                Begin
              </a>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
