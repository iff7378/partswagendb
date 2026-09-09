import type { QueryClient } from '@tanstack/react-query'

import type { TaskAnchor } from './types'

const ANCHOR_PATHS: Record<TaskAnchor['kind'], string> = {
  part: '/parts',
  sale: '/sales?open=',
  vehicle: '/vehicles',
}

export function anchorHref(anchor: TaskAnchor): string {
  return anchor.kind === 'sale'
    ? `/sales?open=${anchor.id}`
    : `${ANCHOR_PATHS[anchor.kind]}/${anchor.id}`
}

/** Everything a task view needs to refresh after a change. */
export function refreshTasks(queryClient: QueryClient) {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
}

