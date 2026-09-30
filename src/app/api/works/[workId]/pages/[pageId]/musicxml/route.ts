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

  if (
    !page?.musicXmlPath ||
    page.recognitionStatus !== "succeeded" ||
    !fs.existsSync(page.musicXmlPath)
  ) {
    return new NextResponse("Derived MusicXML file not found.", {
      status: 404,
    });
  }

  return new NextResponse(fs.readFileSync(page.musicXmlPath), {
    headers: {
      "Content-Type": "application/vnd.recordare.musicxml+xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
