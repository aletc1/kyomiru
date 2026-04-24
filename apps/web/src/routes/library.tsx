import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { z } from 'zod'
import { Search, LayoutGrid, List } from 'lucide-react'
import { useState, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
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
  status: z.enum(LIBRARY_STATUS_VALUES).optional().catch(undefined),
  sort: z.enum(LIBRARY_SORT_VALUES).optional().catch(undefined),
  kind: z.enum(LIBRARY_KIND_VALUES).optional().catch(undefined),
  provider: z.string().optional(),
})

export const Route = createFileRoute('/library')({
  validateSearch: searchSchema,
  component: LibraryPage,
})

function LibraryPage() {
  const { t } = useTranslation('library')
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

  const showKindFilter = facetKinds.length > 1 || (kind !== undefined && !facetKinds.includes(kind))
  const kindOptions = facetKinds.includes(kind as never) || kind === undefined
    ? facetKinds
    : [...facetKinds, kind]
  const showProviderFilter = facetProviders.length > 1 || (provider !== undefined && !facetProviders.some((p) => p.key === provider))
  const providerOptions = provider === undefined || facetProviders.some((p) => p.key === provider)
    ? facetProviders
    : [...facetProviders, { key: provider, displayName: provider }]

  const kindLabel = (k: string) => {
    if (k === 'anime') return t('kind_anime')
    if (k === 'tv') return t('kind_tv')
    if (k === 'movie') return t('kind_movie')
    return k
  }

  return (
    <div className="space-y-4">
      {/* Top bar */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder={t('search_placeholder')}
            value={searchInput}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          onClick={() => setViewMode(viewMode === 'grid' ? 'list' : 'grid')}
          aria-label={t('toggle_view')}
        >
          {viewMode === 'grid' ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
        </Button>
        <Select value={sort} onValueChange={handleSortChange}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder={t('sort_by')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="recent_activity">{t('sort_recent_activity')}</SelectItem>
            <SelectItem value="title_asc">{t('sort_title_asc')}</SelectItem>
            <SelectItem value="rating">{t('sort_rating')}</SelectItem>
            <SelectItem value="last_watched">{t('sort_last_watched')}</SelectItem>
            <SelectItem value="latest_air_date">{t('sort_latest_air_date')}</SelectItem>
          </SelectContent>
        </Select>
        {showKindFilter && (
          <Select value={kind ?? 'all'} onValueChange={handleKindChange}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder={t('filter_type')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter_all_types')}</SelectItem>
              {kindOptions.map((k) => (
                <SelectItem key={k} value={k}>{kindLabel(k)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {showProviderFilter && (
          <Select value={provider ?? 'all'} onValueChange={handleProviderChange}>
            <SelectTrigger className="w-40">
              <SelectValue placeholder={t('filter_provider')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('filter_all_providers')}</SelectItem>
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
          <TabsTrigger value="all">{t('tab_all')}</TabsTrigger>
          <TabsTrigger value="in_progress">{t('tab_in_progress')}</TabsTrigger>
          <TabsTrigger value="new_content" className="gap-1">
            {t('tab_new_content')} {(countData?.count ?? 0) > 0 && <Badge className="h-5 px-1.5 text-xs">{countData?.count}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="watched">{t('tab_watched')}</TabsTrigger>
          <TabsTrigger value="removed">{t('tab_removed')}</TabsTrigger>
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
          <p className="text-xl font-semibold">{t('empty_title')}</p>
          <p className="text-muted-foreground">{t('empty_body')}</p>
        </div>
      ) : (
        <>
          <div className={viewMode === 'grid' ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4' : 'space-y-2'}>
            {allItems.map((show) => <ShowCard key={show.id} show={show} />)}
          </div>
          {hasNextPage && (
            <div className="flex justify-center pt-4">
              <Button variant="outline" onClick={() => fetchNextPage()}>{t('common:load_more')}</Button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
