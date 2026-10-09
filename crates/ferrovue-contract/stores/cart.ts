import { defineStore } from "pinia";

export interface CartState {
  lines: string[];
  owner: string;
  coupon?: string;
}

export const useCart = defineStore("cart", {
  state: (): CartState => ({ lines: [], owner: "" }),
});
