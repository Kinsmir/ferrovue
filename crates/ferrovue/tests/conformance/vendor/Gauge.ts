import { defineComponent, h, inject, onMounted, ref } from "vue";

export default defineComponent({
  name: "Gauge",
  props: { level: { type: Number, required: true } },
  setup(props) {
    const width = ref(window.innerWidth);
    const unit = inject("gauge-unit", "%");
    const measured = ref(false);
    onMounted(() => {
      measured.value = true;
    });
    return () => h("meter", { class: ["gauge", { measured: measured.value }], value: props.level, max: 100, "data-width": width.value }, `${props.level}${unit}`);
  },
});
