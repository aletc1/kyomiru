import { BellRing, Languages, LibraryBig, ListOrdered, Smartphone, Sparkles } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from './ui/card'

interface Feature {
  icon: LucideIcon
  title: string
  body: string
}

const FEATURES: Feature[] = [
  {
    icon: BellRing,
    title: 'New-episode memory',
    body: 'Finished shows automatically surface in New Content the moment a new episode airs — no manual checking.',
  },
  {
    icon: LibraryBig,
    title: 'Unified library',
    body: "Every show you've ever watched in one searchable grid, grouped by status: in progress, new, watched.",
  },
  {
    icon: ListOrdered,
    title: 'Watch queue',
    body: "A drag-and-drop prioritised watchlist separate from your finished shelf. Always know what's next.",
  },
  {
    icon: Languages,
    title: 'Multi-language',
    body: 'Titles and descriptions served in your preferred locale — English, Japanese, Spanish, or French.',
  },
  {
    icon: Sparkles,
    title: 'Auto-classified anime',
    body: 'TV imports get promoted to anime when TMDb + AniList agree. Per-user override always available.',
  },
  {
    icon: Smartphone,
    title: 'Installable PWA',
    body: 'Add Kyomiru to your home screen. Your library stays browsable even when offline.',
  },
]

export function Features() {
  return (
    <section id="features" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">Why Kyomiru</h2>
          <p className="mt-3 text-muted-foreground text-lg">Track once. Get notified when it's back.</p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <Card
              key={f.title}
              className="border-border/50 bg-card/60 backdrop-blur-sm transition-colors hover:border-primary/30 hover:bg-card/80"
            >
              <CardContent className="p-6">
                <div className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                  <f.icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="mb-1.5 font-semibold text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
