import type { RouteSync } from "vike/types";

// Catch-all: matches any URL not matched by other pages.
// precedence: -1 ensures this is checked last (per Vike docs).
const route: RouteSync = () => ({ routeParams: {}, precedence: -1 });
export default route;
