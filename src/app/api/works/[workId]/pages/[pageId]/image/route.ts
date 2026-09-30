import fs from "node:fs";

import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/db/client";
import { workPages } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
      pageId: string;
    }>;
  },
) {
  const { workId, pageId } = await context.params;
  const db = getDatabase();
  const page = db
    .select()
    .from(workPages)
    .where(and(eq(workPages.id, pageId), eq(workPages.workId, workId)))
    .get();

  if (!page || !fs.existsSync(page.imagePath)) {
    return new NextResponse("Page image not found.", {
      status: 404,
    });
  }

  return new NextResponse(fs.readFileSync(page.imagePath), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
    },
  });
}
