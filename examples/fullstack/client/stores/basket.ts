import { defineStore } from "pinia";

/** The reader's basket: the ids of the books in it. The server renders with the state it holds for
 * the reader, and the client starts from the same state (`hydrateState`). */
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
