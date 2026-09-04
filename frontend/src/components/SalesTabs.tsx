import { NavLink } from 'react-router-dom'

/**
 * The schedule is a lens on sales, not a separate thing, so it lives as a tab
 * rather than a seventh item in a bottom bar that is already full on a phone.
 */
export default function SalesTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      isActive ? 'bg-rust text-white' : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
    }`

  return (
    <div className="mb-4 flex gap-2">
      <NavLink to="/sales" end className={tab}>
        All sales
      </NavLink>
      <NavLink to="/sales/schedule" className={tab}>
        Pickup schedule
      </NavLink>
    </div>
  )
}
