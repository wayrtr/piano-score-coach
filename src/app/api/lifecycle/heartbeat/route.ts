import { recordLifecycleHeartbeat } from "@/lib/lifecycle/heartbeat";
import { getRecognitionQueueSnapshot } from "@/lib/recognition/queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET() {
  const recognition = getRecognitionQueueSnapshot();

  return Response.json(
    {
      service: "piano-score-coach",
      busy: recognition.queued.length > 0 || recognition.running.length > 0,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}

export function POST() {
  recordLifecycleHeartbeat();

  return new Response(null, {
    status: 204,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}
