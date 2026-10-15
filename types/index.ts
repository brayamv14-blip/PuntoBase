// ─── Store Config ────────────────────────────────────────────────────────────

export interface StoreConfig {
  id: number;
  store_name: string;
  access_code: string; // bcrypt hashed
  setup_complete: boolean;
  updated_at: string;
}

// ─── Devices ─────────────────────────────────────────────────────────────────

export interface Device {
  id: string;
  name: string;
  device_token: string;
  is_active: boolean;
  registered_at: string;
  last_seen_at: string | null;
}

// Device info returned to client (no token exposed)
export interface DeviceSession {
  id: string;
  name: string;
}

// ─── Categories ──────────────────────────────────────────────────────────────

export interface Category {
  id: string;
  name: string;
  created_at: string;
}

// ─── Products ────────────────────────────────────────────────────────────────

export interface Product {
  id: string;
  category_id: string | null;
  name: string;
  price: number | null;       // always null — price lives on product_variants
  stock_qty: number | null;   // always null — stock lives on product_variants
  low_stock_threshold: number;
  barcode: string | null;
  track_stock: boolean;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined
  category?: Category | null;
  variants?: ProductVariant[];
}

export interface ProductVariant {
  id: string;
  product_id: string;
  size_label: string;
  price: number;
  stock_qty: number;
  low_stock_threshold: number;
  created_at: string;
  updated_at: string;
}

// Composite types for pages that join products + variants
export type ProductWithVariants = Product & { variants: ProductVariant[]; category: { name: string } | null };
export type VariantWithProduct = ProductVariant & { product: { name: string } | null };

// ─── Customers ───────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  created_at: string;
}

// ─── Sales ───────────────────────────────────────────────────────────────────

export type PaymentMethod = 'cash' | 'bank_transfer';
export type DiscountType = 'flat' | 'percent';
export type PaymentStatus = 'paid' | 'pending';

export interface Sale {
  id: string;
  sale_number: string;
  device_id: string | null;
  customer_id: string | null;
  discount_type: DiscountType | null;
  discount_value: number;
  subtotal: number;
  total: number;
  payment_method: PaymentMethod;
  payment_status: PaymentStatus;
  paid_at: string | null;
  notes: string | null;
  created_at: string;
  // Joined
  device?: Device | null;
  customer?: Customer | null;
  items?: SaleItem[];
}

export type SaleItemType = 'product';

export interface SaleItem {
  id: string;
  sale_id: string;
  item_type: SaleItemType;
  product_id: string | null;
  variant_id: string | null;
  description: string;
  unit_price: number;
  qty: number;
  line_total: number;
  refunded_qty: number;
}

// ─── Cart (client-only) ───────────────────────────────────────────────────────

export interface CartItem {
  key: string; // unique key: product_id+variant_id
  item_type: SaleItemType;
  product_id?: string;
  variant_id?: string;
  category_name?: string;
  description: string;
  unit_price: number;
  qty: number;
}

// ─── Expenses ────────────────────────────────────────────────────────────────

export interface Expense {
  id: string;
  description: string;
  amount: number;
  device_id: string | null;
  created_at: string;
  // Joined
  device?: Device | null;
}

// ─── Stock Adjustments ────────────────────────────────────────────────────────

export type AdjustmentType = 'manual' | 'sale' | 'refund';

export interface StockAdjustment {
  id: string;
  product_id: string;
  variant_id: string | null;
  adjustment_type: AdjustmentType;
  qty_before: number;
  qty_change: number;
  qty_after: number;
  note: string | null;
  device_id: string | null;
  related_sale_id: string | null;
  created_at: string;
  // Joined
  product?: Product | null;
  variant?: ProductVariant | null;
}

// ─── Cash Register ────────────────────────────────────────────────────────────

export interface CashRegister {
  id: string;
  date: string; // YYYY-MM-DD
  opening_balance: number;
  expected_cash: number | null;
  actual_cash: number | null;
  discrepancy: number | null;
  notes: string | null;
  closed_by_device_id: string | null;
  closed_at: string | null;
  created_at: string;
}

// ─── API Request / Response types ────────────────────────────────────────────

export interface CreateSaleRequest {
  items: {
    item_type: SaleItemType;
    product_id?: string;
    variant_id?: string;
    description: string;
    unit_price: number;
    qty: number;
  }[];
  customer_id?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  discount_type?: DiscountType | null;
  discount_value?: number;
  payment_method: PaymentMethod;
  notes?: string;
}

