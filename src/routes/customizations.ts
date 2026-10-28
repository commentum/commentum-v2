import { Hono } from "hono";
import { AppContext } from "../types/env";
import { createDb } from "../db";
import { customizationsCatalog } from "../db/schema";
import { eq, and, asc } from "drizzle-orm";

export const customizationsRoutes = new Hono<AppContext>();

/**
 * GET /customizations
 * Public catalog of Discord avatar decorations, nameplates, profile effects, banners
 */
customizationsRoutes.get("/", async (c) => {
  try {
    const type = c.req.query("type");
    const category = c.req.query("category");
    const db = createDb(c.env.DB);

    const filters = [eq(customizationsCatalog.isActive, true)];
    if (type) filters.push(eq(customizationsCatalog.type, type));
    if (category) filters.push(eq(customizationsCatalog.category, category));

    const items = await db
      .select()
      .from(customizationsCatalog)
      .where(and(...filters))
      .orderBy(asc(customizationsCatalog.displayOrder), asc(customizationsCatalog.createdAt));

    return c.json({
      success: true,
      count: items.length,
      items: items.map((it) => ({
        ...it,
        metadata: JSON.parse(it.metadata || "{}"),
      })),
    });
  } catch (error: any) {
    console.error("GET /customizations error:", error);
    return c.json({ success: false, error: error?.message || "Failed to fetch customizations" }, 500);
  }
});
