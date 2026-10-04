/* Types several components share: each imports them from here, so a value one component holds is
 * the value another one takes. */

export type Size = "sm" | "md" | "lg";

export interface Role {
  name: string;
  admin: boolean;
}

export interface User {
  id: number;
  name: string;
  avatar?: string;
  roles: Role[];
  size?: Size;
}

export type Badge = { label: string; tone?: string };
