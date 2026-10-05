<script setup lang="ts">
import { computed } from "vue";
import { useHead } from "@unhead/vue";
import HeadArticle from "./HeadArticle.vue";
import HeadSeo from "./HeadSeo.vue";

const props = defineProps<{
  title: string;
  site: string;
  description?: string;
  lang: string;
  dark: boolean;
  canonical: string;
  tags: string[];
  views: number;
  rating?: number;
  showArticle: boolean;
  author: string | null;
}>();
const heading = computed(() => `${props.title} (${props.views})`);

useHead({
  titleTemplate: `%s · ${props.site}`,
  title: () => props.title,
  htmlAttrs: { lang: props.lang, class: { dark: props.dark, page: true }, "data-views": props.views },
  bodyAttrs: { class: ["body", props.lang], style: { color: "red", "background-color": props.dark ? "black" : "white" } },
  meta: [
    { name: "description", content: props.description },
    { property: "og:title", content: heading },
    { property: "og:image", content: props.tags },
    { name: "keywords", content: props.tags.join(",") },
    { name: "rating", content: props.rating },
    { name: "author", content: props.author },
    { name: "robots", content: "index, follow", key: "robots" },
    { "http-equiv": "x-ua-compatible", content: "IE=edge" },
  ],
  link: [
    { rel: "canonical", href: props.canonical },
    { rel: "stylesheet", href: `/${props.lang}.css` },
    { rel: "preconnect", href: "https://cdn.example" },
    { rel: "alternate", hreflang: props.lang, href: props.canonical },
  ],
  script: [
    { type: "application/ld+json", innerHTML: { "@type": "Article", headline: props.title, views: props.views, tags: props.tags } },
    { src: "/late.js", tagPosition: "bodyClose", defer: true },
    { innerHTML: `window.site = ${JSON.stringify(props.site)}`, tagPosition: "bodyOpen", key: "inline" },
  ],
  style: [{ textContent: `h1::before { content: "${props.site}" }` }],
  noscript: [{ textContent: props.title }],
});
</script>

<template>
  <main>
    <h1>{{ heading }}</h1>
    <HeadArticle v-if="showArticle" :title="title" :tags="tags" />
    <HeadSeo :title="title" :description="description" :views="views" />
  </main>
</template>
