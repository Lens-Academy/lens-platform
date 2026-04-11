export function onBeforePrerenderStart() {
  // List all course IDs to prerender at build time
  return ["/course/default"];
}
