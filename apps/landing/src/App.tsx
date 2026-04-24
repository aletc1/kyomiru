import { I18nextProvider } from 'react-i18next'
import i18n from './i18n'
import { Spotlights } from './components/Spotlights'
import { Nav } from './components/Nav'
import { Hero } from './components/Hero'
import { Features } from './components/Features'
import { HowItWorks } from './components/HowItWorks'
import { Providers } from './components/Providers'
import { Install } from './components/Install'
import { FAQ } from './components/FAQ'
import { Footer } from './components/Footer'

export function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <Spotlights />
      <Nav />
      <main>
        <Hero />
        <Features />
        <HowItWorks />
        <Providers />
        <Install />
        <FAQ />
      </main>
      <Footer />
    </I18nextProvider>
  )
}
