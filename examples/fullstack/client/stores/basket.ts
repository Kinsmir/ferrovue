import { defineStore } from "pinia";

export interface BasketState {
  owner: string;
  ids: string[];
}

export const useBasket = defineStore("basket", {
  state: (): BasketState => ({ owner: "", ids: [] }),
  getters: {
    count: (state) => state.ids.length,
    empty: (state) => state.ids.length === 0,
  },
  actions: {
    add(id: string) {
      if (!this.ids.includes(id)) this.ids.push(id);
    },
  },
});
