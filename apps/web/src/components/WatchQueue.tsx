import { DndContext, closestCenter, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy, arrayMove } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical } from 'lucide-react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { api } from '@/lib/api'
import { Q } from '@/lib/queryKeys'
import type { LibraryResponse } from '@kyomiru/shared/contracts/library'
import { Skeleton } from '@/components/ui/skeleton'

function QueueItem({ show }: { show: LibraryResponse['items'][number] }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: show.id })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className="flex items-center gap-2 rounded-md p-2 hover:bg-sidebar-accent group"
    >
      <span {...attributes} {...listeners} className="cursor-grab text-muted-foreground">
        <GripVertical className="h-4 w-4" />
      </span>
      {show.coverUrl && (
        <img src={show.coverUrl} alt="" className="w-8 h-12 object-cover rounded" />
      )}
      <Link to="/show/$showId" params={{ showId: show.id }} className="flex-1 min-w-0">
        <p className="text-sm font-medium truncate">{show.canonicalTitle}</p>
      </Link>
    </div>
  )
}

export function WatchQueue() {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery<LibraryResponse>({
    queryKey: Q.queue,
    queryFn: () => api.get<LibraryResponse>('/library?sort=queue_position&limit=20'),
    staleTime: 30_000,
  })

  const reorder = useMutation({
    mutationFn: (showIds: string[]) => api.post('/queue/reorder', { showIds }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: Q.queue }),
  })

  const queueItems = (data?.items ?? []).filter((s) => s.queuePosition !== null).sort((a, b) => (a.queuePosition ?? 0) - (b.queuePosition ?? 0))

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = queueItems.findIndex((s) => s.id === active.id)
    const newIndex = queueItems.findIndex((s) => s.id === over.id)
    const reordered = arrayMove(queueItems, oldIndex, newIndex)
    reorder.mutate(reordered.map((s) => s.id))
  }

  if (isLoading) return (
    <div className="space-y-2 p-2">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  )

  if (queueItems.length === 0) return (
    <p className="text-xs text-muted-foreground px-3 py-2">No shows in queue. Favorite a show to add it.</p>
  )

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={queueItems.map((s) => s.id)} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5">
          {queueItems.map((show) => <QueueItem key={show.id} show={show} />)}
        </div>
      </SortableContext>
    </DndContext>
  )
}
