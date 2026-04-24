import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useEffect } from 'react'
import { useRouterState } from '@tanstack/react-router'
import { X } from 'lucide-react'
import { Dialog, DialogPortal, DialogOverlay, DialogClose, DialogTitle } from '@/components/ui/dialog'
import { useAppStore } from '@/lib/store'
import { Logo } from './Logo'
import { SidebarContent } from './Sidebar'

export function MobileSidebar() {
  const { mobileSidebarOpen, setMobileSidebarOpen } = useAppStore()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (useAppStore.getState().mobileSidebarOpen) setMobileSidebarOpen(false)
  }, [pathname, setMobileSidebarOpen])

  useEffect(() => {
    const mql = window.matchMedia('(min-width: 768px)')
    const handler = (e: MediaQueryListEvent) => {
      if (e.matches) setMobileSidebarOpen(false)
    }
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [setMobileSidebarOpen])

  return (
    <Dialog open={mobileSidebarOpen} onOpenChange={setMobileSidebarOpen}>
      <DialogPortal>
        <DialogOverlay className="md:hidden" />
        <DialogPrimitive.Content
          // suppresses Radix's missing-DialogDescription a11y warning
          aria-describedby={undefined}
          className="md:hidden fixed left-0 top-0 z-50 h-full w-[80%] max-w-xs bg-sidebar border-r flex flex-col focus:outline-none"
        >
          <DialogTitle className="sr-only">Navigation</DialogTitle>
          <div className="flex h-14 items-center px-4 border-b">
            <Logo size="sm" showWordmark />
            <DialogClose
              className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Close menu"
            >
              <X className="h-5 w-5" />
            </DialogClose>
          </div>
          <SidebarContent showLabels onNavigate={() => setMobileSidebarOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
