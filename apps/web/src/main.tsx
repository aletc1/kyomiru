import React, { Suspense } from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { Toaster, toast } from 'sonner'
import { registerSW } from 'virtual:pwa-register'
import '@/styles/globals.css'
import i18n from './i18n'
import { routeTree } from './routeTree.gen'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000
const TOAST_BEFORE_RELOAD_MS = 1500

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    toast.info(i18n.t('app_updated_refreshing'), { duration: TOAST_BEFORE_RELOAD_MS })
    setTimeout(() => {
      void updateSW(true)
    }, TOAST_BEFORE_RELOAD_MS)
  },
  onRegisteredSW(_swUrl, registration) {
    if (!registration) return
    const check = () => {
      if (registration.installing) return
      if ('connection' in navigator && !navigator.onLine) return
      registration.update().catch(() => {})
    }
    setInterval(check, UPDATE_CHECK_INTERVAL_MS)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') check()
    })
  },
})

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30_000 } },
})

const router = createRouter({ routeTree, context: { queryClient } })

declare module '@tanstack/react-router' {
  interface Register { router: typeof router }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense>
      <QueryClientProvider client={queryClient}>
        <RouterProvider router={router} />
        <Toaster richColors position="bottom-right" />
      </QueryClientProvider>
    </Suspense>
  </React.StrictMode>,
)
