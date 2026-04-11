import vikeReact from "vike-react/config";
import type { Config } from "vike/types";

export default {
  extends: vikeReact,
  // Default: SPA mode (no server rendering)
  ssr: false,
} satisfies Config;
