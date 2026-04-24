import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { ShowKind } from '@kyomiru/shared'

export const LIBRARY_STATUS_VALUES = ['in_progress', 'new_content', 'watched', 'removed'] as const
export const LIBRARY_SORT_VALUES = ['recent_activity', 'title_asc', 'rating', 'last_watched', 'latest_air_date'] as const
export const LIBRARY_KIND_VALUES = ['anime', 'tv', 'movie'] as const

export type LibraryStatus = typeof LIBRARY_STATUS_VALUES[number] | undefined
export type LibrarySort = typeof LIBRARY_SORT_VALUES[number]
export type LibraryKind = ShowKind | undefined

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'recent_activity'

interface AppStore {
  sidebarOpen: boolean
  viewMode: 'grid' | 'list'
  libraryStatus: LibraryStatus
  librarySort: LibrarySort
  libraryKind: LibraryKind
  libraryProvider: string | undefined
  setSidebarOpen: (open: boolean) => void
  setViewMode: (mode: 'grid' | 'list') => void
  setLibraryStatus: (status: LibraryStatus) => void
  setLibrarySort: (sort: LibrarySort) => void
  setLibraryKind: (kind: LibraryKind) => void
  setLibraryProvider: (provider: string | undefined) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      viewMode: 'grid',
      libraryStatus: undefined,
      librarySort: DEFAULT_LIBRARY_SORT,
      libraryKind: undefined,
      libraryProvider: undefined,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setLibraryStatus: (status) => set({ libraryStatus: status }),
      setLibrarySort: (sort) => set({ librarySort: sort }),
      setLibraryKind: (kind) => set({ libraryKind: kind }),
      setLibraryProvider: (provider) => set({ libraryProvider: provider }),
    }),
    {
      name: 'kyomiru-app',
      partialize: (s) => ({
        viewMode: s.viewMode,
        libraryStatus: s.libraryStatus,
        librarySort: s.librarySort,
        libraryKind: s.libraryKind,
        libraryProvider: s.libraryProvider,
      }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppStore>
        const safeSort = LIBRARY_SORT_VALUES.includes(p.librarySort as LibrarySort)
          ? p.librarySort
          : DEFAULT_LIBRARY_SORT
        return { ...current, ...p, librarySort: safeSort as LibrarySort }
      },
    },
  ),
)
