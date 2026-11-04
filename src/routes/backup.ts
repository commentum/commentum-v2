import { Hono } from "hono";
import { AppContext } from "../types/env";
import { createDb } from "../db";
import { comments } from "../db/schema";
import { asc } from "drizzle-orm";

export const backupRoutes = new Hono<AppContext>();

const CSV_COLUMNS = [
  "id",
  "created_at",
  "updated_at",
  "client_type",
  "user_id",
  "media_id",
  "content",
  "username",
  "user_avatar",
  "avatar_decoration",
  "banner_url",
  "user_role",
  "media_type",
  "media_title",
  "media_year",
  "media_poster",
  "parent_id",
  "deleted",
  "deleted_at",
  "deleted_by",
  "pinned",
  "pinned_at",
  "pinned_by",
  "locked",
  "locked_at",
  "locked_by",
  "edited",
  "edited_at",
  "edit_count",
  "edit_history",
  "upvotes",
  "downvotes",
  "vote_score",
  "user_votes",
  "reported",
  "report_count",
  "reports",
  "report_status",
  "tags",
  "tagged_by",
  "moderated",
  "moderated_at",
  "moderated_by",
  "moderation_reason",
  "moderation_action",
  "translated_content",
  "original_language",
  "translated_at",
];

function formatCsvValue(val: any): string {
  if (val === null || val === undefined) {
    return "";
  }
  let str: string;
  if (typeof val === "object") {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

backupRoutes.get("/", async (c) => {
  const authHeader = c.req.header("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const adminKey = c.req.header("x-admin-key");

  const validToken =
    (c.env.ADMIN_API_KEY && (token === c.env.ADMIN_API_KEY || adminKey === c.env.ADMIN_API_KEY)) ||
    ((c.env as any).BACKUP_TOKEN && token === (c.env as any).BACKUP_TOKEN);

  if (!validToken) {
    return c.json({ error: "Unauthorized: Invalid or missing backup token" }, 401);
  }

  const db = createDb(c.env.DB);
  const allComments: any[] = [];
  const batchSize = 1000;
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const rows = await db
      .select()
      .from(comments)
      .orderBy(asc(comments.id))
      .limit(batchSize)
      .offset(offset);

    if (!rows || rows.length === 0) break;

    allComments.push(...rows);
    offset += rows.length;

    if (rows.length < batchSize) {
      hasMore = false;
    }
  }

  const headerRow = CSV_COLUMNS.join(",");
  const dataRows = allComments.map((row) =>
    CSV_COLUMNS.map((col) => {
      // Map schema snake_case column names to camelCase Drizzle property names
      const camel = col.replace(/_([a-z])/g, (_, g) => g.toUpperCase());
      const val = (row as any)[camel] !== undefined ? (row as any)[camel] : (row as any)[col];
      return formatCsvValue(val);
    }).join(",")
  );

  const csvContent = [headerRow, ...dataRows].join("\n");

  return new Response(csvContent, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="anymex_global_db.csv"',
      "X-Total-Count": String(allComments.length),
    },
  });
});

