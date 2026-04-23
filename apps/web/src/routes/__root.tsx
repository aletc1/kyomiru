import { createRootRouteWithContext, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Sidebar } from '@/components/Sidebar'
import { Menu } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Q } from '@/lib/queryKeys'

export interface RouterContext { queryClient: QueryClient }

type Me = { id: string; email: string; displayName: string; avatarUrl: string | null }

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/login') return
    try {
      await context.queryClient.ensureQueryData<Me>({
        queryKey: Q.me,
        queryFn: async () => {
          const res = await fetch('/api/me', { credentials: 'include' })
          if (!res.ok) throw new Error('unauthenticated')
          return res.json() as Promise<Me>
        },
        staleTime: Infinity,
      })
    } catch {
      throw redirect({ to: '/login' })
    }
  },
  component: RootLayout,
})

function RootLayout() {
  const { setSidebarOpen } = useAppStore()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (pathname === '/login') return <Outlet />
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="flex md:hidden h-14 items-center border-b px-4 gap-3 bg-background sticky top-0 z-10">
          <button onClick={() => setSidebarOpen(true)} aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <span className="font-bold text-lg">Kyomiru</span>
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
