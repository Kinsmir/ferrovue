/* The client's entry, which `vite build` bundles and the server's page loads. */
import "./style.css";
import { hydrate } from "./app.ts";

void hydrate();
