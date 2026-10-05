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
