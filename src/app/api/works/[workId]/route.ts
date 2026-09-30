import { NextResponse } from "next/server";
import { z } from "zod";

import {
  guitarViewModeSchema,
  instrumentModeSchema,
} from "@/lib/domain/types";
import {
  deleteStoredWork,
  getPracticeWorkDetail,
  updatePracticeState,
} from "@/lib/works/practice";
import { listWorks } from "@/lib/works/query";

export const runtime = "nodejs";

const practiceStatePayloadSchema = z.object({
  lastPageIndex: z.number().int().nonnegative(),
  lastObjectId: z.string().nullable(),
  lastMeasure: z.number().int().nonnegative().nullable(),
  instrumentMode: instrumentModeSchema,
  guitarViewMode: guitarViewModeSchema,
  observedAt: z.string().datetime().optional(),
});

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
    }>;
  },
) {
  const { workId } = await context.params;
  const work = getPracticeWorkDetail(workId);

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

export async function PATCH(
  request: Request,
  context: {
    params: Promise<{
      workId: string;
    }>;
  },
) {
  const { workId } = await context.params;
  const payload = practiceStatePayloadSchema.parse(await request.json());
  const work = updatePracticeState(
    {
      workId,
      lastPageIndex: payload.lastPageIndex,
      lastObjectId: payload.lastObjectId,
      lastMeasure: payload.lastMeasure,
      instrumentMode: payload.instrumentMode,
      guitarViewMode: payload.guitarViewMode,
      observedAt: payload.observedAt,
    },
  );

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

export async function DELETE(
  _request: Request,
  context: {
    params: Promise<{
      workId: string;
    }>;
  },
) {
  const { workId } = await context.params;
  const deleted = deleteStoredWork({
    workId,
  });

  if (!deleted) {
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
    works: listWorks(),
  });
}
