import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const LIBRARY_STATUS_VALUES = ['in_progress', 'new_content', 'watched', 'removed'] as const
export const LIBRARY_SORT_VALUES = ['recent_activity', 'title_asc', 'rating', 'updated_date'] as const

export type LibraryStatus = typeof LIBRARY_STATUS_VALUES[number] | undefined
export type LibrarySort = typeof LIBRARY_SORT_VALUES[number]

export const DEFAULT_LIBRARY_SORT: LibrarySort = 'recent_activity'

interface AppStore {
  sidebarOpen: boolean
  viewMode: 'grid' | 'list'
  libraryStatus: LibraryStatus
  librarySort: LibrarySort
  setSidebarOpen: (open: boolean) => void
  setViewMode: (mode: 'grid' | 'list') => void
  setLibraryStatus: (status: LibraryStatus) => void
  setLibrarySort: (sort: LibrarySort) => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      viewMode: 'grid',
      libraryStatus: undefined,
      librarySort: DEFAULT_LIBRARY_SORT,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setViewMode: (mode) => set({ viewMode: mode }),
      setLibraryStatus: (status) => set({ libraryStatus: status }),
      setLibrarySort: (sort) => set({ librarySort: sort }),
    }),
    {
      name: 'kyomiru-app',
      partialize: (s) => ({
        viewMode: s.viewMode,
        libraryStatus: s.libraryStatus,
        librarySort: s.librarySort,
      }),
    },
  ),
)
