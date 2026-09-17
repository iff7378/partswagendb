import { useQuery } from '@tanstack/react-query'

import { api } from '../lib/api'

/** What this bundle was built as; `dev` when running from a working copy. */
const BUILT_AS = import.meta.env.VITE_APP_VERSION ?? 'dev'

/**
 * Says so when the page is running older code than the server is serving.
 *
 * Cache headers only govern requests a browser actually makes. Anything it
 * stored earlier, under whatever rules applied then, it may keep using -- and
 * a stale bundle is invisible, because the version on screen comes from the
 * server while the code does not. This closes that by asking.
 */
export default function UpdateBanner() {
  const health = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ status: string; version: string }>('/health'),
    // A tab left open all day should still notice.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 60 * 1000,
  })

  const serving = health.data?.version
  // Nothing to compare in development, and nothing to say on a fresh load.
  if (!serving || serving === 'dev' || BUILT_AS === 'dev' || serving === BUILT_AS) return null

  return (
    <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <span>
          This page is running an older version ({BUILT_AS}). {serving} is available.
        </span>
        <button
          type="button"
          className="ml-auto rounded-lg bg-amber-200 px-3 py-1 font-medium hover:bg-amber-300"
          // Reload from the server rather than whatever is in the cache.
          onClick={() => window.location.reload()}
        >
          Reload
        </button>
      </div>
    </div>
  )
}
