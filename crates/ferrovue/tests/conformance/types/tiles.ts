export interface TileBadge {
  label: string;
  tone: string;
}

export interface Tile {
  title: string;
  count: number;
  note?: string;
  owner: string | null;
  tags: string[];
  badge?: TileBadge;
}

export interface TileRow {
  id: number;
  label: string;
  href: string;
  first: boolean;
}

export function tileOf(title: string, count: number): Tile {
  if (count === 0) return { title, count, owner: null, tags: [] };
  return { title: title.trim(), count, note: `${count} items`, owner: "team", tags: ["a", title], badge: { label: "new", tone: "ok" } };
}

export function relabel(tile: Tile, title: string): Tile {
  return { ...tile, title };
}
