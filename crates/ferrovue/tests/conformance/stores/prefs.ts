import { defineStore } from "pinia";

export interface Tag {
  name: string;
  color?: string;
}

export interface PrefsState {
  density: string;
  wide: boolean;
  count: number;
  label?: string;
  tags: Tag[];
}

export const usePrefs = defineStore("prefs", {
  state: (): PrefsState => ({ density: "classic", wide: false, count: 0, tags: [] }),
  getters: {
    doubled: (state) => state.count * 2,
    compact: (state) => state.density === "compact",
    tagCount(state): number {
      return state.tags.length;
    },
  },
  actions: {
    toggle() {
      this.wide = !this.wide;
    },
  },
});
