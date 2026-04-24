import { ArrowRight, Github } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'

function LibraryMockup() {
  const { t } = useTranslation('landing')
  const shows = [
    { name: 'Attack on Titan', season: 'Season 4', color: 'bg-orange-800/60' },
    { name: 'Demon Slayer', season: 'Season 3', color: 'bg-rose-800/60' },
    { name: 'Blue Box', season: 'Season 2', color: 'bg-blue-800/60' },
  ]
  return (
    <div className="relative w-full max-w-sm rounded-xl border border-border/50 bg-card/80 p-4 shadow-2xl backdrop-blur-sm">
      {/* Browser-chrome dots */}
      <div className="mb-3 flex items-center gap-1.5">
        <div className="h-2.5 w-2.5 rounded-full bg-border/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-border/80" />
        <div className="h-2.5 w-2.5 rounded-full bg-border/80" />
        <div className="ml-auto text-[11px] text-muted-foreground">kyomiru.app</div>
      </div>

      {/* Tab bar */}
      <div className="mb-3 flex gap-4 border-b border-border/50 pb-2">
        <span className="text-xs text-muted-foreground">{t('hero_mockup_tab_in_progress')}</span>
        <span className="relative border-b-2 border-primary pb-2 text-xs font-semibold text-primary">
          {t('hero_mockup_tab_new_content')}
          <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold">3</span>
        </span>
        <span className="text-xs text-muted-foreground">{t('hero_mockup_tab_watched')}</span>
      </div>

      {/* Show rows */}
      <div className="space-y-1">
        {shows.map((show) => (
          <div key={show.name} className="flex items-center gap-3 rounded-md p-2 hover:bg-secondary/40 transition-colors">
            <div className={`h-10 w-7 shrink-0 rounded ${show.color}`} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-foreground">{show.name}</div>
              <div className="text-[11px] text-muted-foreground">{show.season} — {t('hero_mockup_new_episodes')}</div>
            </div>
            <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-primary/30">
              NEW
            </span>
          </div>
        ))}
      </div>

      {/* Separator + counts */}
      <div className="mt-3 border-t border-border/50 pt-3 space-y-1">
        {[
          { labelKey: 'hero_mockup_tab_in_progress', count: 5 },
          { labelKey: 'hero_mockup_tab_watched', count: 124 },
        ].map((row) => (
          <div key={row.labelKey} className="flex items-center justify-between px-1">
            <span className="text-xs text-muted-foreground">{t(row.labelKey)}</span>
            <span className="text-xs text-muted-foreground">{row.count}</span>
          </div>
        ))}
      </div>

      {/* Glow underneath */}
      <div
        aria-hidden="true"
        style={{ background: 'radial-gradient(closest-side, hsl(238 74% 65% / 0.15), transparent)' }}
        className="pointer-events-none absolute -bottom-12 left-1/2 h-32 w-64 -translate-x-1/2 blur-2xl"
      />
    </div>
  )
}

export function Hero() {
  const { t } = useTranslation('landing')
  return (
    <section className="relative pt-32 pb-20 md:pt-40 md:pb-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2">
          {/* Left column — text */}
          <div className="animate-fade-up">
            {/* Invite-only badge */}
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3.5 py-1.5 text-xs font-semibold text-primary">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              {t('hero_badge')}
            </div>

            <h1 className="text-5xl font-extrabold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              {t('hero_title_prefix')}{' '}
              <span
                style={{
                  backgroundImage: 'linear-gradient(135deg, hsl(238 74% 72%), hsl(258 70% 80%))',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  backgroundClip: 'text',
                }}
              >
                {t('hero_title_word')}
              </span>
            </h1>

            <p className="mt-5 max-w-lg text-lg text-muted-foreground leading-relaxed">
              {t('hero_tagline')}
            </p>

            {/* CTAs */}
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="xl">
                <a href="https://kyomiru.app" target="_blank" rel="noopener noreferrer">
                  {t('hero_begin')}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </Button>
              <Button asChild variant="outline" size="xl">
                <a
                  href="https://github.com/aletc1/kyomiru"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Github className="h-4 w-4" />
                  {t('hero_github')}
                </a>
              </Button>
            </div>

            <p className="mt-4 text-xs text-muted-foreground">{t('hero_footnote')}</p>
          </div>

          {/* Right column — mockup */}
          <div className="flex justify-center lg:justify-end">
            <div className="relative">
              {/* Glow behind mockup */}
              <div
                aria-hidden="true"
                style={{ background: 'radial-gradient(closest-side, hsl(238 74% 65% / 0.25), transparent)' }}
                className="absolute inset-0 -m-12 rounded-full blur-3xl"
              />
              <LibraryMockup />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
