import type { InjectionKey, Ref } from "vue";

export interface TabsState {
  active: string;
  count: number;
}

export const ThemeKey: InjectionKey<string> = Symbol("theme");
export const AccentKey: InjectionKey<Ref<string>> = Symbol("accent");
export const TabsKey = Symbol("tabs") as InjectionKey<TabsState>;
export const SelectKey: InjectionKey<(name: string) => void> = Symbol("select");

export interface Look {
  size: string;
  tone: string;
  note?: string;
  count: number;
}

export const LookKey: InjectionKey<Look> = Symbol("look");
