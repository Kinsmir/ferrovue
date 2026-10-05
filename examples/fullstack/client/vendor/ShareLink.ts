import { defineComponent, h } from "vue";

export default defineComponent({
  name: "ShareLink",
  setup() {
    const href = `mailto:?body=${encodeURIComponent(window.location.href)}`;
    return () => h("a", { class: "share", href }, "Share these reviews");
  },
});
