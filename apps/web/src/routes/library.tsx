import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Search, LayoutGrid, List } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import { useAppStore, LIBRARY_STATUS_VALUES, LIBRARY_SORT_VALUES, LIBRARY_KIND_VALUES, DEFAULT_LIBRARY_SORT } from '@/lib/store'
import type { LibraryResponse, LibraryFacets } from '@kyomiru/shared/contracts/library'
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
  kind: z.enum(LIBRARY_KIND_VALUES).optional(),
  provider: z.string().optional(),
})

export const Route = createFileRoute('/library')({
  validateSearch: searchSchema,
  component: LibraryPage,
})

function LibraryPage() {
  const search = Route.useSearch()
  const navigate = useNavigate({ from: '/library' })
  const {
    viewMode, setViewMode,
    libraryStatus, librarySort, libraryKind, libraryProvider,
    setLibraryStatus, setLibrarySort, setLibraryKind, setLibraryProvider,
  } = useAppStore()
  const [searchInput, setSearchInput] = useState(search.q ?? '')

  const status = search.status ?? libraryStatus
  const sort = search.sort ?? librarySort
  const kind = search.kind ?? libraryKind
  const provider = search.provider ?? libraryProvider
  const q = search.q

  // Hydrate missing URL params from store so the URL stays a canonical
  // reflection of active filters (each param independently).
  useEffect(() => {
    const patch: Record<string, string | undefined> = {}
    if (search.status === undefined && libraryStatus !== undefined) patch.status = libraryStatus
    if (search.sort === undefined && librarySort !== DEFAULT_LIBRARY_SORT) patch.sort = librarySort
    if (search.kind === undefined && libraryKind !== undefined) patch.kind = libraryKind
    if (search.provider === undefined && libraryProvider !== undefined) patch.provider = libraryProvider
    if (Object.keys(patch).length > 0) {
      navigate({ search: (prev) => ({ ...prev, ...patch }), replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { data: countData } = useQuery<NewContentCount>({
    queryKey: Q.newContentCount,
    queryFn: () => api.get<NewContentCount>('/new-content-count'),
  })

  const { data: facetsData } = useQuery<LibraryFacets>({
    queryKey: Q.libraryFacets,
    queryFn: () => api.get<LibraryFacets>('/library/facets'),
    staleTime: 60_000,
  })

  const { data, isLoading, fetchNextPage, hasNextPage } = useInfiniteQuery<LibraryResponse>({
    queryKey: Q.library({ q, status, sort, kind, provider }),
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams()
      if (q) params.set('q', q)
      if (status) params.set('status', status)
      params.set('sort', sort)
      if (kind) params.set('kind', kind)
      if (provider) params.set('provider', provider)
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

  const handleKindChange = useCallback((v: string) => {
    const next = v === 'all' ? undefined : v as typeof kind
    setLibraryKind(next)
    navigate({ search: (prev) => ({ ...prev, kind: next }) })
  }, [navigate, setLibraryKind])

  const handleProviderChange = useCallback((v: string) => {
    const next = v === 'all' ? undefined : v
    setLibraryProvider(next)
    navigate({ search: (prev) => ({ ...prev, provider: next }) })
  }, [navigate, setLibraryProvider])

  const facetProviders = facetsData?.providers ?? []
  const facetKinds = facetsData?.kinds ?? []

  // Show the dropdowns whenever the user has multiple options OR an active
  // filter that isn't in the facets list — otherwise a stale persisted value
  // (e.g. provider=netflix after disconnecting Netflix) would hide the only
  // control that could clear it.
  const showKindFilter = facetKinds.length > 1 || (kind !== undefined && !facetKinds.includes(kind))
  const kindOptions = facetKinds.includes(kind as never) || kind === undefined
    ? facetKinds
    : [...facetKinds, kind]
  const showProviderFilter = facetProviders.length > 1 || (provider !== undefined && !facetProviders.some((p) => p.key === provider))
  const providerOptions = provider === undefined || facetProviders.some((p) => p.key === provider)
    ? facetProviders
    : [...facetProviders, { key: provider, displayName: provider }]

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
        {showKindFilter && (
          <Select value={kind ?? 'all'} onValueChange={handleKindChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {kindOptions.map((k) => (
                <SelectItem key={k} value={k}>
                  {k === 'anime' ? 'Anime' : k === 'tv' ? 'TV' : 'Movie'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {showProviderFilter && (
          <Select value={provider ?? 'all'} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder="Provider" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All providers</SelectItem>
              {providerOptions.map((p) => (
                <SelectItem key={p.key} value={p.key}>{p.displayName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
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
