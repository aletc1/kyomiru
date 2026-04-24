import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'

const QUESTIONS = [
  {
    q: 'Is Kyomiru free?',
    a: `Yes. Kyomiru is fully open source under AGPL-3.0. The hosted beta is free during the invite period. If you self-host, you pay only for whatever VPS or home server you run it on — a Raspberry Pi or small cloud VM is enough.`,
  },
  {
    q: 'Why is sign-up invite-only right now?',
    a: `The hosted instance is still in early access. We're letting a small group in while we harden the sync pipeline and manage hosting costs. Self-hosting has no access gate — clone the repo and you're good to go.`,
  },
  {
    q: 'Which streaming providers are supported?',
    a: `Crunchyroll and Netflix today. The Chrome extension is built around a ProviderAdapter interface, so more can be added without touching the server. Open a GitHub issue to suggest the next one.`,
  },
  {
    q: "Does Kyomiru store my Crunchyroll or Netflix credentials?",
    a: `No. The Chrome extension reads your existing in-browser session — it never sees your password or stores your login credentials. For Crunchyroll, the extension captures a short-lived Bearer JWT from outgoing requests; for Netflix, it uses your active browser cookies. Neither credential is ever sent to Kyomiru's servers. The servers never call Crunchyroll or Netflix directly.`,
  },
  {
    q: 'Why is the extension Chrome-only?',
    a: `The extension is built for Chrome's Manifest V3 platform. The provider adapter logic is framework-agnostic, so a Firefox port is technically straightforward — it just hasn't been built yet. If that's important to you, open an issue.`,
  },
  {
    q: "Why isn't the extension on the Chrome Web Store?",
    a: `It requests broad host permissions on streaming sites in order to read watch history, which triggers a manual review process. We chose to ship via GitHub Releases while the API is still evolving. You load it unpacked through chrome://extensions → Developer Mode — it's the same code, just not store-distributed yet.`,
  },
  {
    q: 'How much does it cost to self-host?',
    a: `Kyomiru runs as two Node.js services (API + web) plus Postgres and Redis. A $5-10/month VPS or a spare Raspberry Pi 4 is sufficient for a single household. Multi-arch Docker images (amd64 + arm64) are published to Quay.io on every release.`,
  },
  {
    q: 'Does this landing page track me?',
    a: `No. There are no third-party analytics scripts, no cookies, no tracking pixels, and no fingerprinting. The only external resource loaded is the Inter font from Google Fonts on page load.`,
  },
]

export function FAQ() {
  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            Frequently asked questions
          </h2>
          <p className="mt-3 text-muted-foreground text-lg">Still curious? Open an issue on GitHub.</p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {QUESTIONS.map((item, idx) => (
            <AccordionItem key={idx} value={`item-${idx}`}>
              <AccordionTrigger className="text-left text-foreground/90">{item.q}</AccordionTrigger>
              <AccordionContent>{item.a}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
