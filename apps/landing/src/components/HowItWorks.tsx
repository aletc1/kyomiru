import { Fragment } from 'react'
import { BrainCircuit, Chrome, ChevronRight, ServerCog, Tv2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from './ui/card'

interface Step {
  number: number
  icon: LucideIcon
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    number: 1,
    icon: Tv2,
    title: 'You watch, as usual',
    body: 'Browse Crunchyroll or Netflix normally. The Kyomiru Chrome extension notices your session — no passwords stored.',
  },
  {
    number: 2,
    icon: Chrome,
    title: 'Extension streams history',
    body: 'Daily or on-demand, the extension paginates your provider history and streams normalised chunks to your Kyomiru instance.',
  },
  {
    number: 3,
    icon: ServerCog,
    title: 'Kyomiru enriches metadata',
    body: 'Shows are matched to TMDb and AniList in the background. Titles, seasons, and episodes are resolved in your language.',
  },
  {
    number: 4,
    icon: BrainCircuit,
    title: 'You get the memory layer',
    body: 'Shows that aired new episodes while you were away move into New Content. Everything else stays tidy in your library.',
  },
]

function ArrowConnector() {
  return (
    <div className="hidden lg:flex shrink-0 items-center justify-center self-center px-1">
      <ChevronRight className="h-5 w-5 text-border" />
    </div>
  )
}

export function HowItWorks() {
  return (
    <section id="how" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">How it works</h2>
          <p className="mt-3 text-muted-foreground text-lg">One extension captures your history. One server remembers.</p>
        </div>

        <div className="flex flex-col lg:flex-row items-stretch gap-3 lg:gap-0">
          {STEPS.map((step, idx) => (
            <Fragment key={step.number}>
              <Card className="flex-1 border-border/50 bg-card/60 backdrop-blur-sm">
                <CardContent className="p-6 h-full flex flex-col">
                  <div className="mb-4 flex items-center gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary ring-1 ring-primary/30">
                      {step.number}
                    </span>
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-secondary/60">
                      <step.icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </div>
                  <h3 className="mb-2 font-semibold text-foreground">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.body}</p>
                </CardContent>
              </Card>
              {idx < STEPS.length - 1 && <ArrowConnector />}
            </Fragment>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground/70">
          Provider credentials stay in your browser. Kyomiru servers never talk to Crunchyroll or Netflix directly — that's the whole point.
        </p>
      </div>
    </section>
  )
}
