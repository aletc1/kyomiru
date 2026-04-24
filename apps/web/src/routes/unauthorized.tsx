import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Logo } from '@/components/Logo'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

const searchSchema = z.object({ email: z.string().optional() })

export const Route = createFileRoute('/unauthorized')({
  validateSearch: searchSchema,
  component: UnauthorizedPage,
})

function UnauthorizedPage() {
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
            <h1 className="text-xl font-bold">Access restricted</h1>
            <p className="text-sm text-muted-foreground">
              This Kyomiru instance is invite-only.
              {email && (
                <>
                  {' '}
                  The address <strong className="text-foreground">{email}</strong> has not been
                  approved.
                </>
              )}
            </p>
            <p className="text-sm text-muted-foreground">
              Ask the administrator to add your email to the allowlist.
            </p>
          </div>
        </CardHeader>
        <CardContent>
          <Button className="w-full" variant="outline" onClick={signOut}>
            Sign in with a different account
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
