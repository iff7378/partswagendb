import { useQuery } from '@tanstack/react-query'

import { PageHeader } from '../components/ui'
import { api } from '../lib/api'
import { KIND_LABELS, KIND_STYLES, RELEASES } from '../lib/changelog'
import { date } from '../lib/format'

/**
 * The release log, in plain words.
 *
 * Kept because git history is written for whoever is reading the code, not for
 * the two people who have to notice that something they use every day now
 * behaves differently.
 */
export default function WhatsNew() {
  const health = useQuery({
    queryKey: ['version'],
    queryFn: () => api.get<{ status: string; version: string }>('/health'),
    staleTime: 60 * 60 * 1000,
  })

  const running = health.data?.version

  return (
    <>
      <PageHeader title="What's new" subtitle="Changes worth noticing, newest first" />

      <div className="space-y-4">
        {RELEASES.map((release) => {
          const live = running === release.version
          return (
            <section key={release.version} className="card p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-bold">{release.headline}</h2>
                <p className="text-xs text-ink-soft">
                  <span className="font-mono">{release.version}</span>
                  {live && (
                    <span className="ml-2 chip bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200">
                      Running now
                    </span>
                  )}
                </p>
              </div>
              <p className="text-sm text-ink-soft">{date(release.on)}</p>

              <ul className="mt-3 space-y-2.5">
                {release.changes.map((change, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-relaxed">
                    <span
                      className={`chip mt-0.5 h-fit shrink-0 ring-1 ${KIND_STYLES[change.kind]}`}
                    >
                      {KIND_LABELS[change.kind]}
                    </span>
                    <span>{change.text}</span>
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>

      <p className="mt-6 text-center text-xs text-ink-soft">
        Older changes than these were the app being built in the first place.
      </p>
    </>
  )
}
