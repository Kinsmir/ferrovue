import { defineComponent, h } from "vue";

export default defineComponent({
  name: "StarRating",
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 5 },
    label: String,
    readonly: Boolean,
  },
  setup(props, { slots }) {
    return () =>
      h("div", { class: "stars", role: "img", "aria-label": props.label ?? `${props.value} of ${props.max}`, "data-readonly": props.readonly ? "" : undefined }, [
        ...Array.from({ length: props.max }, (_, i) => h("span", { class: i < props.value ? "on" : "off" }, "★")),
        slots.default?.(),
      ]);
  },
});
