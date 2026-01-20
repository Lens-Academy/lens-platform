import express, { Request, Response, NextFunction } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";
import { renderPage } from "vike/server";
import sirv from "sirv";

const isProduction = process.env.NODE_ENV === "production";
const port = process.env.PORT || 3000;
const apiUrl = process.env.API_URL || "http://localhost:8000";

async function startServer() {
  const app = express();

  // API and auth proxy
  app.use(
    ["/api", "/auth"],
    createProxyMiddleware({
      target: apiUrl,
      changeOrigin: true,
    })
  );

  if (isProduction) {
    // Serve pre-built static assets
    app.use(sirv("dist/client", { extensions: [] }));
  } else {
    // Use Vite dev server middleware
    const vite = await import("vite");
    const viteDevServer = await vite.createServer({
      server: { middlewareMode: true },
    });
    app.use(viteDevServer.middlewares);
  }

  // Vike middleware - handle all other routes
  app.use(async (req: Request, res: Response, next: NextFunction) => {
    const pageContext = await renderPage({ urlOriginal: req.originalUrl });
    const { httpResponse } = pageContext;

    if (!httpResponse) {
      return next();
    }

    const { statusCode, headers, earlyHints } = httpResponse;

    // Send early hints if supported
    if (res.writeEarlyHints && earlyHints) {
      res.writeEarlyHints({ link: earlyHints.map((e) => e.earlyHintLink) });
    }

    headers.forEach(([name, value]) => res.setHeader(name, value));
    res.status(statusCode);
    httpResponse.pipe(res);
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

startServer();
