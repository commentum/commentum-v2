import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { AppContext } from "./types/env";

import { authRoutes } from "./routes/auth";
import { mediaRoutes } from "./routes/media";
import { commentsRoutes } from "./routes/comments";
import { votesRoutes } from "./routes/votes";
import { reportsRoutes } from "./routes/reports";
import { moderationRoutes } from "./routes/moderation";
import { notificationsRoutes } from "./routes/notifications";
import { pointsRoutes } from "./routes/points";
import { customizationsRoutes } from "./routes/customizations";
import { usersRoutes } from "./routes/users";
import { announcementsRoutes } from "./routes/announcements";
import { discordRoutes } from "./routes/discord";

const app = new Hono<AppContext>();

// Global Middleware
app.use("*", logger());
app.use(
  "*",
  cors({
    origin: "*",
    allowHeaders: ["Content-Type", "Authorization", "x-session-token", "appauth", "apikey"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);

// Health Check
app.get("/health", (c) => {
  return c.json({
    status: "healthy",
    service: "Commentum v2 API (Hono + Cloudflare D1)",
    version: "2.0.0",
    timestamp: new Date().toISOString(),
  });
});

// Interactive API Documentation
app.get("/openapi.json", async (c) => {
  const spec = await import("../docs/openapi.json");
  return c.json(spec.default || spec);
});

app.get("/docs", (c) => {
  return c.html(`<!doctype html>
<html lang="en">
  <head>
    <title>Commentum v2 API Documentation</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { margin: 0; background: #0f0f13; }
    </style>
  </head>
  <body>
    <script id="api-reference" data-url="/openapi.json" data-theme="dark"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});

// Mount Routes
app.route("/auth", authRoutes);
app.route("/media", mediaRoutes);
app.route("/comments", commentsRoutes);
app.route("/votes", votesRoutes);
app.route("/reports", reportsRoutes);
app.route("/moderation", moderationRoutes);
app.route("/notifications", notificationsRoutes);
app.route("/points", pointsRoutes);
app.route("/customizations", customizationsRoutes);
app.route("/users", usersRoutes);
app.route("/announcements", announcementsRoutes);
app.route("/discord", discordRoutes);

// Global 404 Handler
app.notFound((c) => {
  return c.json({ success: false, error: `Endpoint not found: ${c.req.method} ${c.req.path}` }, 404);
});

// Global Error Handler
app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json({ success: false, error: err.message || "Internal server error" }, 500);
});

export default app;
