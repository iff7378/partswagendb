import { NavLink } from 'react-router-dom'

/** The ledger is the same money in more detail, so it is a tab, not a page. */
export default function MoneyTabs() {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-3 py-1.5 text-sm font-medium transition ${
      isActive ? 'bg-rust text-white' : 'bg-slate-100 text-ink-soft hover:bg-slate-200'
    }`

  return (
    <div className="mb-4 flex gap-2">
      <NavLink to="/money" end className={tab}>
        Summary
      </NavLink>
      <NavLink to="/money/ledger" className={tab}>
        Every line
      </NavLink>
    </div>
  )
}
