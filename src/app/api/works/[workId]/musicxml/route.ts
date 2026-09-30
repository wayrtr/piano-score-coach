import fs from "node:fs";

import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { getDatabase } from "@/lib/db/client";
import { workPages, works } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
    }>;
  },
) {
  const { workId } = await context.params;
  const db = getDatabase();
  const work = db.select().from(works).where(eq(works.id, workId)).get();

  if (!work || work.sourceType !== "musicxml") {
    return new NextResponse("MusicXML work not found.", {
      status: 404,
    });
  }

  const page = db
    .select()
    .from(workPages)
    .where(eq(workPages.workId, workId))
    .orderBy(asc(workPages.pageIndex))
    .get();

  if (!page || !fs.existsSync(page.imagePath)) {
    return new NextResponse("MusicXML file not found.", {
      status: 404,
    });
  }

  return new NextResponse(fs.readFileSync(page.imagePath), {
    headers: {
      "Content-Type": "application/vnd.recordare.musicxml+xml; charset=utf-8",
    },
  });
}
