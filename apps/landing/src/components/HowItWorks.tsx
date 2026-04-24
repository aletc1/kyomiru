import { Fragment } from 'react'
import { BrainCircuit, Chrome, ChevronRight, ServerCog, Tv2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Card, CardContent } from './ui/card'

const STEP_ICONS: LucideIcon[] = [Tv2, Chrome, ServerCog, BrainCircuit]
const STEP_NUMBERS = [1, 2, 3, 4]

function ArrowConnector() {
  return (
    <div className="hidden lg:flex shrink-0 items-center justify-center self-center px-1">
      <ChevronRight className="h-5 w-5 text-border" />
    </div>
  )
}

export function HowItWorks() {
  const { t } = useTranslation('landing')
  return (
    <section id="how" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('how_heading')}</h2>
          <p className="mt-3 text-muted-foreground text-lg">{t('how_subheading')}</p>
        </div>

        <div className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-0">
          {STEP_NUMBERS.map((n, idx) => {
            const Icon = STEP_ICONS[idx]!
            return (
              <Fragment key={n}>
                <Card className="flex-1 border-border/50 bg-card/60 backdrop-blur-sm">
                  <CardContent className="p-6 h-full flex flex-col">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary ring-1 ring-primary/30">
                        {n}
                      </span>
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/60">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                    <h3 className="mb-2 font-semibold text-foreground">{t(`how_step${n}_title`)}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{t(`how_step${n}_body`)}</p>
                  </CardContent>
                </Card>
                {idx < STEP_NUMBERS.length - 1 && <ArrowConnector />}
              </Fragment>
            )
          })}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground/70">{t('how_footnote')}</p>
      </div>
    </section>
  )
}
