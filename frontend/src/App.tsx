import { Suspense, lazy } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import Layout from './components/Layout'
import { Spinner } from './components/ui'
import { useAuth } from './lib/auth'
import Dashboard from './pages/Dashboard'
import Login from './pages/Login'
import Money from './pages/Money'
import MoneyLedger from './pages/MoneyLedger'
import PartDetailPage from './pages/PartDetail'
import PartNew from './pages/PartNew'
import Parts from './pages/Parts'
import Sales from './pages/Sales'
import SaleSchedule from './pages/SaleSchedule'
import Help from './pages/Help'
import Settings from './pages/Settings'
import Locations from './pages/Locations'
import VehicleDetailPage from './pages/VehicleDetail'
import Vehicles from './pages/Vehicles'

// The QR decoder is a large dependency and only matters once you scan something.
const Scan = lazy(() => import('./pages/Scan'))

export default function App() {
  const { user, loading } = useAuth()

  if (loading) return <Spinner label="Starting up…" />
  if (!user) return <Login />

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/parts" element={<Parts />} />
        <Route path="/parts/new" element={<PartNew />} />
        <Route path="/parts/:id" element={<PartDetailPage />} />
        <Route path="/vehicles" element={<Vehicles />} />
        <Route path="/vehicles/:id" element={<VehicleDetailPage />} />
        <Route path="/locations" element={<Locations />} />
        <Route path="/sales" element={<Sales />} />
        <Route path="/sales/schedule" element={<SaleSchedule />} />
        <Route path="/money" element={<Money />} />
        <Route path="/money/ledger" element={<MoneyLedger />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/help" element={<Help />} />
        <Route
          path="/scan"
          element={
            <Suspense fallback={<Spinner label="Starting the camera…" />}>
              <Scan />
            </Suspense>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
