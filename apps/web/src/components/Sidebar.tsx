import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Activity, Sparkles, CheckCheck, Settings, Plug, ChevronLeft, ChevronRight } from 'lucide-react'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { useAppStore } from '@/lib/store'
import { WatchQueue } from './WatchQueue'
import { Badge } from './ui/badge'
import { Logo } from './Logo'
import { cn } from '@/lib/utils'
import type { NewContentCount } from '@kyomiru/shared/contracts/auth'

const NAV = [
  { label: 'In Progress', to: '/library?status=in_progress', icon: Activity },
  { label: 'New Content', to: '/library?status=new_content', icon: Sparkles, badge: true },
  { label: 'Watched', to: '/library?status=watched', icon: CheckCheck },
]

export function SidebarContent({
  showLabels,
  onNavigate,
}: {
  showLabels: boolean
  onNavigate?: () => void
}) {
  const { data: countData } = useQuery<NewContentCount>({
    queryKey: Q.newContentCount,
    queryFn: () => api.get<NewContentCount>('/new-content-count'),
    staleTime: 60_000,
  })

  const newCount = countData?.count ?? 0

  return (
    <nav className="flex-1 overflow-y-auto py-4 space-y-1 px-2">
      {showLabels && <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Discover</p>}
      {NAV.map(({ label, to, icon: Icon, badge }) => (
        <Link
          key={to}
          to={to as '/library'}
          onClick={onNavigate}
          className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent text-sidebar-foreground transition-colors"
        >
          <Icon className="h-4 w-4 shrink-0" />
          {showLabels && (
            <>
              <span className="flex-1">{label}</span>
              {badge && newCount > 0 && <Badge className="h-5 px-1.5 text-xs">{newCount}</Badge>}
            </>
          )}
        </Link>
      ))}

      {showLabels && (
        <>
          <div className="pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-2 mb-2">Watch Queue</p>
            <WatchQueue />
          </div>
          <div className="pt-4 border-t">
            <Link to="/services" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent text-sidebar-foreground">
              <Plug className="h-4 w-4 shrink-0" /> Services
            </Link>
            <Link to="/settings" onClick={onNavigate} className="flex items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-sidebar-accent text-sidebar-foreground">
              <Settings className="h-4 w-4 shrink-0" /> Settings
            </Link>
          </div>
        </>
      )}
    </nav>
  )
}

export function Sidebar() {
  const { sidebarOpen, setSidebarOpen } = useAppStore()

  return (
    <aside
      className={cn(
        'hidden md:flex flex-col border-r bg-sidebar h-screen sticky top-0 transition-all duration-200',
        sidebarOpen ? 'w-60' : 'w-14',
      )}
    >
      <div className="flex h-14 items-center px-4 border-b">
        {sidebarOpen
          ? <Logo size="sm" showWordmark />
          : <Logo size="sm" showWordmark={false} />
        }
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="ml-auto text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Toggle sidebar"
        >
          {sidebarOpen ? <ChevronLeft className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
        </button>
      </div>

      <SidebarContent showLabels={sidebarOpen} />
    </aside>
  )
}
