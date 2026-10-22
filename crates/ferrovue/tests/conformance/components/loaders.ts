import { defineLoader } from "ferrovue/client";

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
