import { NextResponse } from "next/server";

import { rerunPracticeObject } from "@/lib/works/practice";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
      objectId: string;
    }>;
  },
) {
  const { workId, objectId } = await context.params;
  const outcome = await rerunPracticeObject({
    workId,
    objectId,
  });

  if (!outcome) {
    return NextResponse.json(
      {
        error: "Score object not found.",
      },
      {
        status: 404,
      },
    );
  }

  if (outcome.result.recognitionStatus === "failed") {
    return NextResponse.json(
      {
        error: outcome.result.errorMessage,
        work: outcome.work,
      },
      {
        status: 422,
      },
    );
  }

  return NextResponse.json({
    work: outcome.work,
  });
}
