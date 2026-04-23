import { createFileRoute } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export const Route = createFileRoute('/login')({
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Kyomiru</CardTitle>
          <p className="text-muted-foreground">Your anime & TV watch memory</p>
        </CardHeader>
        <CardContent>
          <Button className="w-full" asChild>
            <a href="/api/auth/google">
              Sign in with Google
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
