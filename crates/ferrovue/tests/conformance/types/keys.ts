import type { InjectionKey, Ref } from "vue";

export interface TabsState {
  active: string;
  count: number;
}

export const ThemeKey: InjectionKey<string> = Symbol("theme");
export const AccentKey: InjectionKey<Ref<string>> = Symbol("accent");
export const TabsKey = Symbol("tabs") as InjectionKey<TabsState>;
export const SelectKey: InjectionKey<(name: string) => void> = Symbol("select");
