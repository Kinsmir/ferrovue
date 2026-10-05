import { type Plugin } from "../plugin.ts";
import { router } from "./router.ts";
import { piniaStores } from "./stores.ts";
import { sharedTypes } from "./shared-types.ts";
import { i18n } from "./i18n.ts";
import { teleport } from "./teleport.ts";
import { scoped } from "./scoped.ts";
import { clientOnly } from "./client-only.ts";
import { twinsPlugin } from "./twins.ts";
import { provideInject } from "./provide.ts";
import { head } from "./head.ts";

export const PLUGINS: readonly Plugin[] = [router, piniaStores, sharedTypes, i18n, teleport, scoped, clientOnly, twinsPlugin, provideInject, head];
