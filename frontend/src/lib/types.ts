export type UserRole = 'admin' | 'staff' | 'viewer'

export type PartStatus = 'draft' | 'available' | 'reserved' | 'sold' | 'scrapped'
export type PartCondition = 'new' | 'a' | 'b' | 'c' | 'core' | 'salvage' | 'unknown'
export type VehicleStatus = 'acquired' | 'teardown' | 'complete' | 'scrapped'
export type LocationKind = 'site' | 'shelf' | 'bay' | 'bin'
export type SaleChannel = 'ebay' | 'facebook' | 'local' | 'phone' | 'other'
export type ExpenseCategory =
  | 'purchase'
  | 'transport'
  | 'tooling'
  | 'disposal'
  | 'storage'
  | 'fees'
  | 'other'

export interface UserBrief {
  id: number
  full_name: string
  email: string
}

export interface User extends UserBrief {
  role: UserRole
  is_active: boolean
  is_partner: boolean
  share_bps: number
  created_at: string
}

export interface Page<T> {
  items: T[]
  total: number
  limit: number
  offset: number
}

export interface VehicleBrief {
  id: number
  stock_number: string
  display_name: string
}

export interface Vehicle extends VehicleBrief {
  vin: string | null
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  engine: string | null
  transmission: string | null
  drive_type: string | null
  body_style: string | null
  color: string | null
  mileage: number | null
  status: VehicleStatus
  acquired_on: string | null
  acquired_from: string | null
  notes: string | null
  created_at: string
  created_by: UserBrief | null
}

export interface VehicleDetail extends Vehicle {
  part_count: number
  parts_sold: number
  total_expenses: string
  total_revenue: string
  profit: string
}

export interface VinDecodeResult {
  vin: string
  year: number | null
  make: string | null
  model: string | null
  trim: string | null
  engine: string | null
  transmission: string | null
  drive_type: string | null
  body_style: string | null
}

export interface StorageLocation {
  id: number
  code: string
  name: string
  kind: LocationKind
  parent_id: number | null
  path: string
  notes: string | null
  created_at: string
}

export interface LocationNode extends StorageLocation {
  children: LocationNode[]
  part_count: number
}

export interface Category {
  id: number
  name: string
  slug: string
  path: string
  parent_id: number | null
}

export interface CategoryNode extends Category {
  children: CategoryNode[]
}

export interface Tag {
  id: number
  name: string
}

export interface Photo {
  id: number
  object_key: string
  original_filename: string | null
  content_type: string
  size_bytes: number
  width: number | null
  height: number | null
  is_primary: boolean
  ocr_status: 'pending' | 'running' | 'done' | 'failed' | 'skipped'
  ocr_text: string | null
  ocr_candidates: { value: string; confidence: number }[] | null
  created_at: string
  url: string | null
  thumbnail_url: string | null
}

export interface Part {
  id: number
  sku: string
  title: string
  description: string | null
  vehicle_id: number | null
  category_id: number | null
  location_id: number | null
  part_number: string | null
  oem_number: string | null
  manufacturer: string | null
  condition: PartCondition
  status: PartStatus
  quantity: number
  asking_price: string | null
  notes: string | null
  is_complete: boolean
  created_at: string
  updated_at: string
  vehicle: VehicleBrief | null
  category: Category | null
  location: StorageLocation | null
  tags: Tag[]
  primary_photo_url: string | null
}

export interface PartDetail extends Part {
  photos: Photo[]
  created_by: UserBrief | null
}

export interface SaleItem {
  id: number
  part_id: number | null
  part_sku: string | null
  description: string
  quantity: number
  unit_price: string
  line_total: string
}

export interface Sale {
  id: number
  reference: string
  sold_on: string
  channel: SaleChannel
  buyer_name: string | null
  buyer_contact: string | null
  shipping: string
  fees: string
  tax: string
  subtotal: string
  net_collected: string
  collected_by_id: number
  collected_by: UserBrief
  payment_method: string | null
  notes: string | null
  created_at: string
}

export interface SaleDetail extends Sale {
  items: SaleItem[]
}

export interface Expense {
  id: number
  vehicle_id: number | null
  description: string
  category: ExpenseCategory
  amount: string
  incurred_on: string
  paid_by_id: number
  paid_by: UserBrief
  notes: string | null
  created_at: string
}

export interface PartnerBalance {
  user: UserBrief
  share_bps: number
  expenses_paid: string
  revenue_collected: string
  settlements_paid: string
  settlements_received: string
  net_holding: string
  entitled: string
  delta: string
}

export interface Transfer {
  from_user: UserBrief
  to_user: UserBrief
  amount: string
}

export interface SettleUpReport {
  period_start: string
  period_end: string
  total_revenue: string
  total_expenses: string
  profit: string
  balances: PartnerBalance[]
  transfers: Transfer[]
  unallocated_share_bps: number
}

export interface Settlement {
  id: number
  period_start: string
  period_end: string
  paid_on: string
  from_user: UserBrief
  to_user: UserBrief
  amount: string
  method: string | null
  notes: string | null
  created_at: string
}

export interface DashboardStats {
  parts_total: number
  parts_available: number
  parts_draft: number
  parts_sold: number
  vehicles_total: number
  vehicles_in_teardown: number
  revenue_last_30_days: string
  expenses_last_30_days: string
  inventory_asking_value: string
}
