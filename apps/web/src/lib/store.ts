import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppStore {
  sidebarOpen: boolean
  viewMode: 'grid' | 'list'
  setSidebarOpen: (open: boolean) => void
  setViewMode: (mode: 'grid' | 'list') => void
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      viewMode: 'grid',
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setViewMode: (mode) => set({ viewMode: mode }),
    }),
    { name: 'kyomiru-app', partialize: (s) => ({ viewMode: s.viewMode }) },
  ),
)
