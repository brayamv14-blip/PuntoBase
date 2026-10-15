"use client";
import { createContext, useContext, useReducer, useCallback } from "react";
import type { CartItem, DiscountType, PaymentMethod } from "@/types";

interface CartState {
  items: CartItem[];
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  discount_type: DiscountType | null;
  discount_value: number;
  payment_method: PaymentMethod;
  notes: string;
}

type CartAction =
  | { type: "ADD_ITEM"; item: CartItem }
  | { type: "REMOVE_ITEM"; key: string }
  | { type: "SET_QTY"; key: string; qty: number }
  | { type: "SET_PRICE"; key: string; price: number }
  | { type: "SET_CUSTOMER"; id: string | null; name: string; phone: string }
  | { type: "SET_DISCOUNT"; discount_type: DiscountType | null; discount_value: number }
  | { type: "SET_PAYMENT"; method: PaymentMethod }
  | { type: "SET_NOTES"; notes: string }
  | { type: "CLEAR" };

const initialState: CartState = {
  items: [],
  customer_id: null,
  customer_name: "",
  customer_phone: "",
  discount_type: null,
  discount_value: 0,
  payment_method: "cash",
  notes: "",
};

function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const existing = state.items.find((i) => i.key === action.item.key);
      if (existing) {
        return {
          ...state,
          items: state.items.map((i) =>
            i.key === action.item.key ? { ...i, qty: i.qty + action.item.qty } : i
          ),
        };
      }
      return { ...state, items: [...state.items, action.item] };
    }
    case "REMOVE_ITEM":
      return { ...state, items: state.items.filter((i) => i.key !== action.key) };
    case "SET_QTY":
      return {
        ...state,
        items: state.items
          .map((i) => (i.key === action.key ? { ...i, qty: action.qty } : i))
          .filter((i) => i.qty > 0),
      };
    case "SET_PRICE":
      return {
        ...state,
        items: state.items.map((i) => (i.key === action.key ? { ...i, unit_price: action.price } : i)),
      };
    case "SET_CUSTOMER":
      return { ...state, customer_id: action.id, customer_name: action.name, customer_phone: action.phone };
    case "SET_DISCOUNT":
      return { ...state, discount_type: action.discount_type, discount_value: action.discount_value };
    case "SET_PAYMENT":
      return { ...state, payment_method: action.method };
    case "SET_NOTES":
      return { ...state, notes: action.notes };
    case "CLEAR":
      return initialState;
    default:
      return state;
  }
}

interface CartContextValue extends CartState {
  subtotal: number;
  discountAmount: number;
  total: number;
  addItem: (item: CartItem) => void;
  removeItem: (key: string) => void;
  setQty: (key: string, qty: number) => void;
  setPrice: (key: string, price: number) => void;
  setCustomer: (id: string | null, name: string, phone: string) => void;
  setDiscount: (type: DiscountType | null, value: number) => void;
  setPayment: (method: PaymentMethod) => void;
  setNotes: (notes: string) => void;
  clear: () => void;
}

const CartContext = createContext<CartContextValue | null>(null);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(cartReducer, initialState);

  const subtotal = state.items.reduce((sum, i) => sum + i.unit_price * i.qty, 0);
  const discountAmount =
    state.discount_type === "flat"
      ? state.discount_value
      : state.discount_type === "percent"
      ? (subtotal * state.discount_value) / 100
      : 0;
  const total = Math.max(0, subtotal - discountAmount);

  const addItem = useCallback((item: CartItem) => dispatch({ type: "ADD_ITEM", item }), []);
  const removeItem = useCallback((key: string) => dispatch({ type: "REMOVE_ITEM", key }), []);
  const setQty = useCallback((key: string, qty: number) => dispatch({ type: "SET_QTY", key, qty }), []);
  const setPrice = useCallback((key: string, price: number) => dispatch({ type: "SET_PRICE", key, price }), []);
  const setCustomer = useCallback(
    (id: string | null, name: string, phone: string) =>
      dispatch({ type: "SET_CUSTOMER", id, name, phone }),
    []
  );
  const setDiscount = useCallback(
    (discount_type: DiscountType | null, discount_value: number) =>
      dispatch({ type: "SET_DISCOUNT", discount_type, discount_value }),
    []
  );
  const setPayment = useCallback((method: PaymentMethod) => dispatch({ type: "SET_PAYMENT", method }), []);
  const setNotes = useCallback((notes: string) => dispatch({ type: "SET_NOTES", notes }), []);
  const clear = useCallback(() => dispatch({ type: "CLEAR" }), []);

  const value: CartContextValue = {
    ...state,
    subtotal,
    discountAmount,
    total,
    addItem,
    removeItem,
    setQty,
    setPrice,
    setCustomer,
    setDiscount,
    setPayment,
    setNotes,
    clear,
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}
