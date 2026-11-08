import type { TrustedHtml } from "ferrovue/types";

export interface Fielded {
  title: string;
  body: TrustedHtml;
  counts: Record<string, number>;
  labels: Record<string, string>;
}
