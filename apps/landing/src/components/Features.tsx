import { BellRing, Languages, LibraryBig, ListOrdered, Smartphone, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from './ui/card'

const FEATURE_ICONS: LucideIcon[] = [BellRing, LibraryBig, ListOrdered, Languages, Sparkles, Smartphone]
const FEATURE_KEYS = ['1', '2', '3', '4', '5', '6']

export function Features() {
  const { t } = useTranslation('landing')
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('features_heading')}</h2>
          <p className="mt-3 text-muted-foreground text-lg">{t('features_subheading')}</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURE_KEYS.map((k, idx) => {
            const Icon = FEATURE_ICONS[idx]!
            return (
              <Card
                key={k}
                className="border-border/50 bg-card/60 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-card/80"
              >
                <CardContent className="p-6">
                  <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <h3 className="mb-1.5 font-semibold text-foreground">{t(`feature_${k}_title`)}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{t(`feature_${k}_body`)}</p>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    </section>
  )
}
