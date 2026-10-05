/* What a `.vue` file is to TypeScript, which reads no `.vue` file itself: `@vitejs/plugin-vue`
 * compiles each into a module whose default export is the component. */
declare module "*.vue" {
  import type { Component } from "vue";
  const component: Component;
  export default component;
}
