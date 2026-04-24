import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Search, LayoutGrid, List } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { useAppStore, LIBRARY_STATUS_VALUES, LIBRARY_SORT_VALUES, DEFAULT_LIBRARY_SORT } from '@/lib/store'
import type { LibraryResponse } from '@kyomiru/shared/contracts/library'
import type { NewContentCount } from '@kyomiru/shared/contracts/auth'
import { ShowCard } from '@/components/ShowCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'

const searchSchema = z.object({
  q: z.string().optional(),
  status: z.enum(LIBRARY_STATUS_VALUES).optional(),
  sort: z.enum(LIBRARY_SORT_VALUES).optional(),
})

export const Route = createFileRoute('/library')({
  validateSearch: searchSchema,
  component: LibraryPage,
})

function LibraryPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/library' })
  const { viewMode, setViewMode, libraryStatus, librarySort, setLibraryStatus, setLibrarySort } = useAppStore()
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  const status = search.status ?? libraryStatus
  const sort = search.sort ?? librarySort
  const q = search.q

  // On mount, hydrate missing URL params from the store so the URL stays a
  // canonical reflection of the active filter/sort (each param independently).
  useEffect(() => {
    const patch: { status?: typeof libraryStatus; sort?: typeof librarySort } = {}
    if (search.status === undefined && libraryStatus !== undefined) patch.status = libraryStatus
    if (search.sort === undefined && librarySort !== DEFAULT_LIBRARY_SORT) patch.sort = librarySort
    if (patch.status !== undefined || patch.sort !== undefined) {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: countData } = useQuery<NewContentCount>({
    queryKey: Q.newContentCount,
    queryFn: () => api.get<NewContentCount>('/new-content-count'),
  })

  const { data, isLoading, fetchNextPage, hasNextPage } = useInfiniteQuery<LibraryResponse>({
    queryKey: Q.library({ q, status, sort }),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      params.set('sort', sort)
      if (pageParam) params.set('cursor', pageParam as string)
      return api.get<LibraryResponse>(`/library?${params}`)
    },
    initialPageParam: undefined,
    getNextPageParam: (last) => last.pageInfo.nextCursor ?? undefined,
    staleTime: 30_000,
  })

  const allItems = data?.pages.flatMap((p) => p.items) ?? []

  const handleSearch = useCallback((val: string) => {
    setSearchInput(val)
    navigate({ search: (prev) => ({ ...prev, q: val || undefined }) })
  }, [navigate])

  const handleStatusChange = useCallback((v: string) => {
    const next = v === 'all' ? undefined : v as typeof status
    setLibraryStatus(next)
    navigate({ search: (prev) => ({ ...prev, status: next }) })
  }, [navigate, setLibraryStatus])

  const handleSortChange = useCallback((v: string) => {
    const next = v as typeof sort
    setLibrarySort(next)
    navigate({ search: (prev) => ({ ...prev, sort: next }) })
  }, [navigate, setLibrarySort])

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search shows..."
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          aria-label="Toggle view"
        >
          {viewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent_activity">Recent Activity</SelectItem>
            <SelectItem value="title_asc">Title A-Z</SelectItem>
            <SelectItem value="rating">Rating</SelectItem>
            <SelectItem value="updated_date">Updated Date</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabs */}
      <Tabs value={status ?? 'all'} onValueChange={handleStatusChange}>
        <TabsList className="w-full justify-start overflow-x-auto">
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="in_progress">In Progress</TabsTrigger>
          <TabsTrigger value="new_content" className="gap-1">
            New Content {(countData?.count ?? 0) > 0 && <Badge className="h-5 px-1.5 text-xs">{countData?.count}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="watched">Watched</TabsTrigger>
          <TabsTrigger value="removed">Removed</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Grid or List */}
      {isLoading ? (
        <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4' : 'space-y-2'}>
          {Array.from({ length: 12 }).map((_, i) => (
            <Skeleton key={i} className={viewMode === 'grid' ? 'aspect-[2/3] rounded-lg' : 'h-16 rounded-lg'} />
          ))}
        </div>
      ) : allItems.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 text-center gap-4">
          <span className="text-6xl">📺</span>
          <p className="text-xl font-semibold">No shows yet</p>
          <p className="text-muted-foreground">Connect a service and sync to see your library.</p>
        </div>
      ) : (
        <>
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4' : 'space-y-2'}>
            {allItems.map((show) => <ShowCard key={show.id} show={show} />)}
          </div>
          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={() => fetchNextPage()}>Load more</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
