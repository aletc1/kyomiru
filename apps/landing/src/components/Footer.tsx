import { Github } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export function Footer() {
  const { t } = useTranslation('landing')
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
              {t('footer_github')}
            </a>
            <a
              href="https://github.com/aletc1/kyomiru/blob/main/LICENSE"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              {t('footer_license')}
            </a>
            <a
              href="https://github.com/aletc1/kyomiru/releases/latest"
              target="_blank"
              rel="noopener noreferrer"
              className="transition-colors hover:text-foreground"
            >
              {t('footer_releases')}
            </a>
          </div>
        </div>

        <div className="mt-6 border-t border-border/40 pt-6 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-muted-foreground/60">
            {t('footer_copyright', { year: new Date().getFullYear() })}
          </p>
          <p className="text-xs text-muted-foreground/40">{t('footer_trademark')}</p>
        </div>
      </div>
    </footer>
  )
}
