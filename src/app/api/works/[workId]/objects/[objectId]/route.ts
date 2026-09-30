import { NextResponse } from "next/server";
import { z } from "zod";

import { updateScoreObject } from "@/lib/works/practice";

export const runtime = "nodejs";

const updateObjectPayloadSchema = z.object({
  notes: z.array(z.string().min(1)).min(1),
});

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      workId: string;
      objectId: string;
    }>;
  },
) {
  const { workId, objectId } = await context.params;
  const payload = updateObjectPayloadSchema.parse(await request.json());
  const work = updateScoreObject({
    workId,
    objectId,
    notes: payload.notes,
  });

  if (!work) {
    return NextResponse.json(
      {
        error: "Score object not found.",
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
