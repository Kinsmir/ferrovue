import { defineComponent, h } from "vue";

export default defineComponent({
  name: "StarRating",
  props: {
    value: { type: Number, required: true },
    max: { type: Number, default: 5 },
  },
  setup(props) {
    return () =>
      h(
        "span",
        { class: "rating", role: "img", "aria-label": `${props.value} out of ${props.max}` },
        Array.from({ length: props.max }, (_, i) => (i < props.value ? "★" : "☆")).join(""),
      );
  },
});
