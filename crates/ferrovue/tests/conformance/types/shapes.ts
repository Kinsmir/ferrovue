import ShapeCircle from "../components/ShapeCircle.vue";
import ShapeSquare from "../components/ShapeSquare.vue";

export type Shape = "circle" | "square";

export const SHAPES = { circle: ShapeCircle, square: ShapeSquare } as const;
