import { defineLoader } from "ferrovue";
import type { Stock, Warehouse } from "./types.ts";

async function json<T>(href: string): Promise<T> {
  const response = await fetch(href);
  if (!response.ok) throw new Error(`${href} answered ${response.status}`);
  return (await response.json()) as T;
}

export const loadStock = defineLoader("loadStock", async (id: string): Promise<Stock> => {
  const { counted, ...stock } = await json<Omit<Stock, "counted"> & { counted?: string }>(`/api/stock/${encodeURIComponent(id)}`);
  return counted === undefined ? stock : { ...stock, counted: new Date(counted) };
});

export const loadWarehouse = defineLoader("loadWarehouse", async (code: string): Promise<Warehouse | null> =>
  json(`/api/warehouses/${encodeURIComponent(code)}`),
);
