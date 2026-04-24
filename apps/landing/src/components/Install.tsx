import { ArrowRight, Download, Github, Server } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'

export function Install() {
  const { t } = useTranslation('landing')
  return (
    <section id="install" className="py-20 md:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-12 text-center">
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{t('install_heading')}</h2>
          <p className="mt-3 text-muted-foreground text-lg">{t('install_subheading')}</p>
        </div>

        {/* Two main cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Hosted beta */}
          <Card className="border-primary/30 bg-card/60 backdrop-blur-sm">
            <CardContent className="p-6 md:p-8 flex flex-col gap-5 h-full">
              <div className="flex items-start justify-between gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 ring-1 ring-primary/20">
                  <ArrowRight className="h-5 w-5 text-primary" />
                </div>
                <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                  {t('install_hosted_badge')}
                </span>
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{t('install_hosted_title')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('install_hosted_body')}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button asChild>
                  <a href="https://kyomiru.app" target="_blank" rel="noopener noreferrer">
                    {t('install_hosted_begin')}
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="ghost">
                  <a
                    href="https://github.com/aletc1/kyomiru/issues/new?labels=access-request&title=Access+request"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('install_hosted_request')}
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Self-host */}
          <Card className="border-border/50 bg-card/60 backdrop-blur-sm">
            <CardContent className="p-6 md:p-8 flex flex-col gap-5 h-full">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-secondary ring-1 ring-border/60">
                <Server className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-foreground mb-2">{t('install_selfhost_title')}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{t('install_selfhost_body')}</p>
              </div>
              <div className="mt-auto flex flex-wrap gap-2">
                <Button asChild variant="outline">
                  <a href="https://github.com/aletc1/kyomiru" target="_blank" rel="noopener noreferrer">
                    <Github className="h-4 w-4" />
                    {t('install_selfhost_github')}
                  </a>
                </Button>
                <Button asChild variant="ghost">
                  <a
                    href="https://github.com/aletc1/kyomiru/blob/main/charts/kyomiru/README.md"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t('install_selfhost_helm')}
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Extension download strip */}
        <div className="mt-8 rounded-xl border border-border/50 bg-card/40 px-6 py-6 md:px-8 backdrop-blur-sm">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="font-semibold text-foreground">{t('install_ext_title')}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{t('install_ext_body')}</p>
              <p className="mt-1 text-xs text-muted-foreground/60">{t('install_ext_hint')}</p>
            </div>
            <div className="shrink-0">
              <Button asChild size="lg">
                <a
                  href="https://github.com/aletc1/kyomiru/releases/latest"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Download className="h-4 w-4" />
                  {t('install_ext_download')}
                </a>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
