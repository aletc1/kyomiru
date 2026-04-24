import { Github } from 'lucide-react'

export function Footer() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          {/* Brand */}
          <div className="flex items-center gap-2.5">
            <img src="/logo-master.png" alt="Kyomiru" className="h-7 w-7 rounded-md" />
            <span className="text-sm font-semibold text-foreground">Kyomiru</span>
          </div>

          {/* Links */}
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <a
              href="https://github.com/aletc1/kyomiru"
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 transition-colors hover:text-foreground"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
            <a
              href="https://github.com/aletc1/kyomiru/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              AGPL-3.0
            </a>
            <a
              href="https://github.com/aletc1/kyomiru/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              Releases
            </a>
          </div>
        </div>

        <div className="mt-6 border-t border-border/40 pt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground/60">
            © {new Date().getFullYear()} Kyomiru contributors. Open source under AGPL-3.0.
          </p>
          <p className="text-xs text-muted-foreground/40">
            Not affiliated with Crunchyroll or Netflix. All trademarks belong to their respective owners.
          </p>
        </div>
      </div>
    </footer>
  )
}
