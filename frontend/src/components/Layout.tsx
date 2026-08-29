import { NavLink, Outlet } from 'react-router-dom'

import { useAuth } from '../lib/auth'

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/parts', label: 'Parts' },
  { to: '/vehicles', label: 'Cars' },
  { to: '/locations', label: 'Storage' },
  { to: '/sales', label: 'Sales' },
  { to: '/money', label: 'Money' },
]

function navClass({ isActive }: { isActive: boolean }): string {
  return [
    'rounded-lg px-3 py-2 text-sm font-medium transition',
    isActive ? 'bg-rust text-white' : 'text-ink-soft hover:bg-slate-100 hover:text-ink',
  ].join(' ')
}

function mobileNavClass({ isActive }: { isActive: boolean }): string {
  return [
    'flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition',
    isActive ? 'text-rust' : 'text-ink-soft',
  ].join(' ')
}

export default function Layout() {
  const { user, signOut } = useAuth()

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <NavLink to="/" className="flex items-center gap-2 font-bold tracking-tight">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-rust text-sm text-white">
              PW
            </span>
            <span className="hidden sm:inline">PartsWagen</span>
          </NavLink>

          <nav className="hidden flex-1 items-center gap-1 md:flex">
            {NAV.map((item) => (
              <NavLink key={item.to} to={item.to} end={item.end} className={navClass}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NavLink to="/scan" className="btn-secondary !px-3 !py-2" title="Scan a QR code">
              <ScanIcon />
              <span className="hidden sm:inline">Scan</span>
            </NavLink>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{user?.full_name}</p>
              <p className="text-xs capitalize leading-tight text-ink-soft">{user?.role}</p>
            </div>
            <button type="button" onClick={signOut} className="btn-secondary !px-3 !py-2">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pb-28 pt-5 md:pb-10">
        <Outlet />
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t border-slate-200 bg-white pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.end} className={mobileNavClass}>
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

function ScanIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M3 12h18" />
    </svg>
  )
}
