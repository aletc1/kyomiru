import { createFileRoute } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Logo } from '@/components/Logo'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const { t } = useTranslation('auth')
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center items-center gap-3">
          <Logo size="lg" showWordmark />
          <p className="text-muted-foreground text-sm">{t('tagline')}</p>
          {error && (
            <p className="text-sm text-destructive">
              {error === 'auth_failed' ? t('sign_in_failed') : error}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Button className="w-full" asChild>
            <a href="/api/auth/google">{t('sign_in_google')}</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
