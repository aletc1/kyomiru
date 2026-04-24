import { Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from './ui/card'

function ProviderCard({ src, name, note, href }: { src: string; name: string; note: string; href: string }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="flex-1 min-w-[160px] max-w-[240px]">
      <Card className="h-full border-border/50 bg-card/60 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-card/80">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-8 px-6 h-full">
          <img src={src} alt={name} className="h-7 object-contain" />
          <div className="text-xs text-muted-foreground">{note}</div>
        </CardContent>
      </Card>
    </a>
  )
}

function GhostCard() {
  const { t } = useTranslation('landing')
  return (
    <a
      href="https://github.com/aletc1/kyomiru/issues/new?labels=provider-request&title=Provider+request%3A+%5Bservice+name%5D"
      target="_blank"
      rel="noopener noreferrer"
      className="flex-1 min-w-[160px] max-w-[240px]"
    >
      <Card className="h-full border-dashed border-border/40 bg-transparent transition-colors hover:border-primary/40 hover:bg-primary/5">
        <CardContent className="flex flex-col items-center justify-center gap-3 py-8 px-6 h-full">
          <div className="flex h-10 w-10 items-center justify-center rounded-full border border-dashed border-border/60">
            <Plus className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-muted-foreground">{t('providers_suggest')}</div>
            <div className="mt-0.5 text-xs text-muted-foreground/60">{t('providers_suggest_sub')}</div>
          </div>
        </CardContent>
      </Card>
    </a>
  )
}

export function Providers() {
  const { t } = useTranslation('landing')
  return (
    <section id="providers" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('providers_heading')}</h2>
          <p className="mt-3 text-muted-foreground text-lg">{t('providers_subheading')}</p>
        </div>

        <div className="flex flex-wrap justify-center gap-4">
          <ProviderCard
            src="/providers/crunchyroll.png"
            name="Crunchyroll"
            note={t('providers_browser_session')}
            href="https://www.crunchyroll.com"
          />
          <ProviderCard
            src="/providers/netflix.svg"
            name="Netflix"
            note={t('providers_browser_session')}
            href="https://www.netflix.com"
          />
          <GhostCard />
        </div>

        <p className="mt-8 text-center text-xs text-muted-foreground/50">{t('providers_disclaimer')}</p>
      </div>
    </section>
  )
}
