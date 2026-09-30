import fs from "node:fs";
import path from "node:path";

const DEFAULT_HEARTBEAT_FILE = path.join(
  process.cwd(),
  ".runtime",
  "piano-score-coach.heartbeat",
);

export function getLifecycleHeartbeatFile() {
  return process.env.PIANO_COACH_HEARTBEAT_FILE ?? DEFAULT_HEARTBEAT_FILE;
}

export function recordLifecycleHeartbeat(timestamp = Date.now()) {
  const heartbeatFile = getLifecycleHeartbeatFile();

  fs.mkdirSync(path.dirname(heartbeatFile), { recursive: true });
  fs.writeFileSync(heartbeatFile, `${timestamp}\n`, "utf8");
}
