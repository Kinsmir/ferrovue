import { defineComponent, h } from "vue";

export default defineComponent({
  name: "StarRating",
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 5 },
  },
  setup(props, { slots }) {
    return () => h("span", { class: "stars" }, [`${props.value}/${props.max}`, slots.default?.()]);
  },
});
