import { defineLoader } from "ferrovue";

export interface Search {
  term: string;
  page?: number;
  lang: string | null;
}

export const loadFound = defineLoader("loadFound", async (search: Search, max?: number): Promise<string[]> => {
  const response = await fetch(`/api/found/${search.term}?max=${max ?? 10}`);
  return (await response.json()) as string[];
});
