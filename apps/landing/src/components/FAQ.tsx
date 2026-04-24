import { useTranslation } from 'react-i18next'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from './ui/accordion'

const FAQ_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8']

export function FAQ() {
  const { t } = useTranslation('landing')
  return (
    <section id="faq" className="py-20 md:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
            {t('faq_heading')}
          </h2>
          <p className="mt-3 text-muted-foreground text-lg">{t('faq_subheading')}</p>
        </div>

        <Accordion type="single" collapsible className="w-full">
          {FAQ_KEYS.map((k) => (
            <AccordionItem key={k} value={`item-${k}`}>
              <AccordionTrigger className="text-left text-foreground/90">{t(`faq_q${k}`)}</AccordionTrigger>
              <AccordionContent>{t(`faq_a${k}`)}</AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  )
}
