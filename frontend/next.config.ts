import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The app is entirely client-side, so it exports to static files that FastAPI
   * serves from the same origin as the API — one process, one port, no Node
   * runtime in the container.
   */
  output: "export",
  /*
   * Exports every route as `<route>/index.html` rather than `<route>.html`,
   * which is the layout Starlette's StaticFiles serves directly.
   */
  trailingSlash: true,
};

export default nextConfig;
