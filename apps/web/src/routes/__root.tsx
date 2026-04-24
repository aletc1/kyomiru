import { createRootRouteWithContext, Outlet, redirect, useRouterState } from '@tanstack/react-router'
import type { QueryClient } from '@tanstack/react-query'
import { Sidebar } from '@/components/Sidebar'
import { MobileSidebar } from '@/components/MobileSidebar'
import { Logo } from '@/components/Logo'
import { Menu } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { Q } from '@/lib/queryKeys'
import { loadLocale } from '@/i18n'
import { useTranslation } from 'react-i18next'

export interface RouterContext { queryClient: QueryClient }

type Me = { id: string; email: string; displayName: string; avatarUrl: string | null; preferredLocale: string | null }

export const Route = createRootRouteWithContext<RouterContext>()({
  beforeLoad: async ({ context, location }) => {
    if (location.pathname === '/login' || location.pathname === '/unauthorized') return
    let me: Me
    try {
      me = await context.queryClient.ensureQueryData<Me>({
        queryKey: Q.me,
        queryFn: async () => {
          const res = await fetch('/api/me', { credentials: 'include' })
          if (res.status === 403) throw new Error('not_approved')
          if (!res.ok) throw new Error('unauthenticated')
          return res.json() as Promise<Me>
        },
        staleTime: Infinity,
      })
    } catch (err) {
      if (err instanceof Error && err.message === 'not_approved') {
        throw redirect({ to: '/unauthorized' })
      }
      throw redirect({ to: '/login' })
    }
    if (me.preferredLocale) {
      try {
        await loadLocale(me.preferredLocale)
      } catch (err) {
        console.warn('[i18n] failed to load locale bundle, falling back to en-US', err)
      }
    }
  },
  component: RootLayout,
})

function RootLayout() {
  const { setMobileSidebarOpen } = useAppStore()
  const { t } = useTranslation()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (pathname === '/login' || pathname === '/unauthorized') return <Outlet />
  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <MobileSidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <header className="flex md:hidden h-14 items-center border-b px-4 gap-3 bg-background sticky top-0 z-10">
          <button onClick={() => setMobileSidebarOpen(true)} aria-label={t('open_menu')}>
            <Menu className="h-5 w-5" />
          </button>
          <Logo size="sm" showWordmark />
        </header>
        <main className="flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
