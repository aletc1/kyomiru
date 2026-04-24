import { useState } from 'react'
import { Github, Menu, X, Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import i18n, { localeToPath, persistLocale } from '../i18n'
import { updateHead } from '../i18n/head'

function LangSwitcher() {
  const { i18n: i18nHook } = useTranslation()
  const current = i18nHook.language

  const options = [
    { locale: 'en-US', label: 'EN' },
    { locale: 'es-ES', label: 'ES' },
    { locale: 'fr-FR', label: 'FR' },
  ]

  const switchTo = (locale: string) => {
    persistLocale(locale)
    i18n.changeLanguage(locale)
    updateHead(locale)
    const path = localeToPath(locale)
    window.history.pushState({}, '', path)
  }

  return (
    <div className="flex items-center gap-0.5">
      <Globe className="h-4 w-4 text-muted-foreground mr-1" />
      {options.map((opt) => (
        <button
          key={opt.locale}
          onClick={() => switchTo(opt.locale)}
          className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
            current === opt.locale
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  )
}

export function Nav() {
  const { t } = useTranslation('landing')
  const [open, setOpen] = useState(false)

  const NAV_LINKS = [
    { labelKey: 'nav_features', href: '#features' },
    { labelKey: 'nav_how', href: '#how' },
    { labelKey: 'nav_providers', href: '#providers' },
    { labelKey: 'nav_faq', href: '#faq' },
  ]

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
              {t(link.labelKey)}
            </a>
          ))}
        </nav>

        {/* Desktop right actions */}
        <div className="hidden md:flex items-center gap-2">
          <LangSwitcher />
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
              {t('nav_begin')}
            </a>
          </Button>
        </div>

        {/* Mobile menu toggle */}
        <button
          className="md:hidden flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
          onClick={() => setOpen((v) => !v)}
          aria-label={t('nav_toggle_menu')}
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
                {t(link.labelKey)}
              </a>
            ))}
          </nav>
          <div className="mt-3 flex items-center gap-2 border-t border-border/40 pt-3">
            <LangSwitcher />
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
                {t('nav_begin')}
              </a>
            </Button>
          </div>
        </div>
      )}
    </header>
  )
}
