export interface Reply {
  author: string;
  at: Date;
  edited?: Date;
  removed: Date | null;
  replies: Reply[];
}

export interface Thread {
  title: string;
  opened: Date;
  replies: Reply[];
  pinned: Record<string, Date>;
  seen: (Date | null)[];
}
