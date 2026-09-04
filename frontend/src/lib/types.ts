export type UserRole = 'admin' | 'staff' | 'viewer'

export type PartStatus = 'draft' | 'available' | 'reserved' | 'sold' | 'scrapped'
export type PartCondition = 'new' | 'a' | 'b' | 'c' | 'core' | 'salvage' | 'unknown'
export type VehicleStatus = 'acquired' | 'in_teardown' | 'stripped' | 'scrapped'
export type LocationKind = 'site' | 'shelf' | 'bay' | 'bin'
export type SaleState = 'pending' | 'paid' | 'gone' | 'complete' | 'voided'
export type SaleChannel = 'ebay' | 'facebook' | 'local' | 'phone' | 'scrap' | 'other'
export type ExpenseCategory =
  | 'purchase'
  | 'transport'
  | 'tooling'
  | 'disposal'
  | 'storage'
  | 'fees'
  | 'supplies'
  | 'meals'
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
  /** Nickname when the car has one, otherwise year/make/model. */
  display_name: string
}

export interface Vehicle extends VehicleBrief {
  vin: string | null
  vin_unknown: boolean
  nickname: string | null
  description: string
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
  scrap_revenue: string
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
  /** Could still go on a sale: right status, and not already on one. */
  is_sellable: boolean
  days_in_stock: number
  is_overdue: boolean
  age_alert_days: number | null
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

export interface SaleItemPart {
  id: number
  sku: string
  title: string
}

export interface SaleItem {
  id: number
  /** Everything this line covered: one part, a lot of them, or none. */
  parts: SaleItemPart[]
  vehicle_id: number | null
  vehicle_name: string | null
  is_shell: boolean
  description: string
  quantity: number
  unit_price: string
  line_total: string
}

export interface Sale {
  id: number
  reference: string
  sold_on: string
  paid_on: string | null
  fulfilled_on: string | null
  /** ISO instant the buyer said they would turn up, or null. */
  meetup_at: string | null
  voided_at: string | null
  void_reason: string | null
  voided_by: UserBrief | null
  state: SaleState
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
  parts_overdue: number
  vehicles_total: number
  vehicles_in_teardown: number
  revenue_last_30_days: string
  expenses_last_30_days: string
  inventory_asking_value: string
}

export interface VehicleResult {
  id: number
  stock_number: string
  display_name: string
  status: VehicleStatus
  acquired_on: string | null
  parts_total: number
  parts_sold: number
  total_expenses: string
  total_revenue: string
  scrap_revenue: string
  profit: string
}

export interface VehicleResults {
  vehicles: VehicleResult[]
  /** Overheads belonging to no car, which is why the rows never sum to profit. */
  general_expenses: string
  /** Paid lines that reached no car at all. */
  unattributed_revenue: string
  /** Shipping and tax less fees, charged per sale rather than per car. */
  sale_adjustments: string
}

export interface AppMetrics {
  parts_by_status: Record<string, number>
  parts_total: number
  vehicles_by_status: Record<string, number>
  vehicles_total: number
  sales_total: number
  sale_lines_total: number
  gross_sales: string
  expenses_total: number
  expenses_amount: string
  settlements_total: number
  photos_total: number
  photo_bytes: number
  largest_photo_bytes: number
  users_total: number
  users_active: number
  locations_total: number
  categories_total: number
  tags_total: number
  database_bytes: number | null
}

export interface SiteBrief {
  id: number
  name: string
}

export interface ScheduleEntry {
  id: number
  reference: string
  state: SaleState
  meetup_at: string | null
  buyer_name: string | null
  buyer_contact: string | null
  channel: SaleChannel
  net_collected: string
  paid_on: string | null
  summary: string
  part_count: number
  /** Derived from where the parts are kept; null when nothing is shelved. */
  site: SiteBrief | null
}

export interface Schedule {
  scheduled: ScheduleEntry[]
  unscheduled: ScheduleEntry[]
  sites: SiteBrief[]
}

export interface VehicleSaleLine {
  sale_id: number
  reference: string
  sold_on: string
  paid_on: string | null
  state: SaleState
  buyer_name: string | null
  description: string
  is_shell: boolean
  quantity: number
  line_total: string
  /** 'shell', 'car' (a lot named against it) or 'parts'. */
  via: string
}

export interface LedgerEntry {
  on: string
  kind: 'sale' | 'expense' | 'settlement'
  reference: string
  description: string
  vehicle_id: number | null
  vehicle_name: string | null
  person: string
  /** Positive is money in, negative is money out. */
  amount: string
  state: SaleState | null
  /** False for an agreed-but-unpaid sale: shown, but outside every total. */
  counted: boolean
  sale_id: number | null
}

export interface Ledger {
  entries: LedgerEntry[]
  money_in: string
  money_out: string
  profit: string
  uncounted: string
}

export interface AuditEntry {
  id: number
  at: string
  user_name: string | null
  action: 'created' | 'updated' | 'deleted'
  entity: string
  entity_id: number | null
  label: string | null
  changes: Record<string, unknown> | null
}
