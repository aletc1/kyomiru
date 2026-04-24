import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Logo } from '@/components/Logo'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  const error = new URLSearchParams(window.location.search).get('error')

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center items-center gap-3">
          <Logo size="lg" showWordmark />
          <p className="text-muted-foreground text-sm">Your anime &amp; TV watch memory</p>
          {error && (
            <p className="text-sm text-destructive">
              {error === 'auth_failed' ? 'Sign-in failed. Please try again.' : error}
            </p>
          )}
        </CardHeader>
        <CardContent>
          <Button className="w-full" asChild>
            <a href="/api/auth/google">Sign in with Google</a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
