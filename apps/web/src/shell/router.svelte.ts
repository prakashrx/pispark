import { parseRoute, type Route } from "../routes";

/** The screen the address names, kept in step with the address. */
class Router {
  route = $state<Route>({ name: "home" });
  constructor() {
    if (typeof window === "undefined") return;
    this.sync();
    window.addEventListener("hashchange", () => this.sync());
  }
  /** Reads the address again, as when the app starts. */
  sync() {
    this.route = parseRoute(window.location.hash);
  }
}

export const router = new Router();
