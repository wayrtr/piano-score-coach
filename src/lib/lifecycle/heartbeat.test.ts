// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { recordLifecycleHeartbeat } from "@/lib/lifecycle/heartbeat";

const originalHeartbeatFile = process.env.PIANO_COACH_HEARTBEAT_FILE;
const tempDirs: string[] = [];

afterEach(() => {
  if (originalHeartbeatFile === undefined) {
    delete process.env.PIANO_COACH_HEARTBEAT_FILE;
  } else {
    process.env.PIANO_COACH_HEARTBEAT_FILE = originalHeartbeatFile;
  }

  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("lifecycle heartbeat", () => {
  it("records the latest page-presence timestamp for the local supervisor", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piano-heartbeat-"));
    const heartbeatFile = path.join(tempDir, "runtime", "heartbeat");

    tempDirs.push(tempDir);
    process.env.PIANO_COACH_HEARTBEAT_FILE = heartbeatFile;

    recordLifecycleHeartbeat(1_725_000_000_000);

    expect(fs.readFileSync(heartbeatFile, "utf8")).toBe("1725000000000\n");
  });
});
