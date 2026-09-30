import { NextResponse } from "next/server";
import { z } from "zod";

import { updateWorkKey } from "@/lib/works/practice";

export const runtime = "nodejs";

const workKeyPayloadSchema = z.object({
  key: z.string().min(1),
});

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      workId: string;
    }>;
  },
) {
  const { workId } = await context.params;
  const payload = workKeyPayloadSchema.parse(await request.json());
  const work = updateWorkKey({
    workId,
    nextKey: payload.key,
  });

  if (!work) {
    return NextResponse.json(
      {
        error: "Work not found.",
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
