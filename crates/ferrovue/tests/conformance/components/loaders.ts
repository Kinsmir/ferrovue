import { defineLoader } from "ferrovue";
import type { Thread } from "../types/dated.ts";

export interface Author {
  name: string;
  bio?: string;
}

export interface Article {
  title: string;
  tags: string[];
  author: Author | null;
}

export interface Ranking {
  scores: Record<string, number>;
  best?: number;
  worst: number | null;
  open: boolean | null;
}

function missing(name: string): never {
  throw new Error(`the fixture gives no result for ${name}`);
}

export const loadArticle = defineLoader("loadArticle", async (slug: string, lang?: string): Promise<Article> => missing(`${slug} ${lang}`));

export const loadViews = defineLoader("loadViews", async (): Promise<number> => missing("views"));

export const loadComments = defineLoader("loadComments", async (article: string, page: number, drafts: boolean | null): Promise<string[]> =>
  missing(`${article} ${page} ${drafts}`),
);

export const loadNote = defineLoader("loadNote", async (page: number): Promise<string | null> => missing(`note ${page}`));

export const loadRanking = defineLoader("loadRanking", async (board: string): Promise<Ranking> => missing(`ranking ${board}`));

export const loadOpened = defineLoader("loadOpened", async (name: string): Promise<Date> => missing(`opened ${name}`));

export const loadClosed = defineLoader("loadClosed", async (name: string): Promise<Date | null> => missing(`closed ${name}`));

export const loadDays = defineLoader("loadDays", async (): Promise<Date[]> => missing("days"));

export const loadThread = defineLoader("loadThread", async (id: number): Promise<Thread> => missing(`thread ${id}`));

export interface Query {
  term: string;
  page: number;
  exact?: boolean;
  lang: string | null;
}

export const loadHits = defineLoader("loadHits", async (query: Query): Promise<string[]> => missing(`hits ${query.term}`));

export const loadTotal = defineLoader("loadTotal", async (query: Query, scale?: number): Promise<number> => missing(`total ${query.term} ${scale}`));
