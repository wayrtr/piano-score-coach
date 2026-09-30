import { NextResponse } from "next/server";

import { getPracticeWorkDetail, rerunPracticePage } from "@/lib/works/practice";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
      pageId: string;
    }>;
  },
) {
  const { workId, pageId } = await context.params;
  const currentWork = getPracticeWorkDetail(workId);

  if (currentWork?.sourceType === "musicxml") {
    return NextResponse.json(
      {
        error: "MusicXML 作品直接走本地结构化解析，不支持整页重识别。",
        work: currentWork,
      },
      {
        status: 422,
      },
    );
  }

  const work = await rerunPracticePage({
    workId,
    pageId,
  });

  if (!work) {
    return NextResponse.json(
      {
        error: "Work page not found.",
      },
      {
        status: 404,
      },
    );
  }

  return NextResponse.json({
    work,
  });
}
