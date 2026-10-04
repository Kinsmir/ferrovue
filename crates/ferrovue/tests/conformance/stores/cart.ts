import { defineStore } from "pinia";

export interface Line {
  sku: string;
  qty: number;
}

export interface CartState {
  lines: Line[];
  coupon?: string;
  owner: string;
}

export const useCart = defineStore("cart", {
  state: (): CartState => ({ lines: [], owner: "" }),
  getters: {
    empty: (state) => state.lines.length === 0,
    label: (state) => `${state.owner}'s cart`,
    discounted: (state) => state.coupon !== undefined,
  },
  actions: {
    add(sku: string) {
      this.lines.push({ sku, qty: 1 });
    },
  },
});
