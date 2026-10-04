/* A client-only directive: it has no `getSSRProps`, so it renders nothing on the server. */
import type { Directive } from "vue";

export const vFocus: Directive<HTMLElement> = {
  mounted(el) {
    el.focus();
  },
};
