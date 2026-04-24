import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const searchSchema = z.object({ email: z.string().optional() })

export const Route = createFileRoute('/unauthorized')({
  validateSearch: searchSchema,
  component: UnauthorizedPage,
})

function UnauthorizedPage() {
  const { t } = useTranslation('auth')
  const { email } = Route.useSearch()

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center items-center gap-3">
          <Logo size="lg" showWordmark />
          <div className="space-y-1">
            <h1 className="text-xl font-bold">{t('access_restricted')}</h1>
            <p className="text-sm text-muted-foreground">
              {t('invite_only')}
              {email && (
                <>
                  {' '}
                  <span dangerouslySetInnerHTML={{ __html: t('not_approved', { email }) }} />
                </>
              )}
            </p>
            <p className="text-sm text-muted-foreground">{t('contact_admin')}</p>
          </div>
        </CardHeader>
        <CardContent>
          <Button className="w-full" variant="outline" onClick={signOut}>
            {t('sign_in_different')}
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
