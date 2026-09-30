// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { GET, POST } from "@/app/api/lifecycle/heartbeat/route";
import { enqueueRecognitionTask } from "@/lib/recognition/queue";

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

describe("lifecycle heartbeat route", () => {
  it("accepts a page-presence heartbeat without returning a body", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piano-route-"));
    const heartbeatFile = path.join(tempDir, "heartbeat");

    tempDirs.push(tempDir);
    process.env.PIANO_COACH_HEARTBEAT_FILE = heartbeatFile;

    const response = POST();

    expect(response.status).toBe(204);
    expect(fs.readFileSync(heartbeatFile, "utf8")).toMatch(/^\d+\n$/);
  });

  it("identifies the local service without refreshing page presence", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piano-route-"));
    const heartbeatFile = path.join(tempDir, "heartbeat");

    tempDirs.push(tempDir);
    process.env.PIANO_COACH_HEARTBEAT_FILE = heartbeatFile;

    const response = GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "piano-score-coach",
      busy: false,
    });
    expect(fs.existsSync(heartbeatFile)).toBe(false);
  });

  it("reports the service as busy while recognition work is running", async () => {
    let releaseTask: (() => void) | undefined;
    const taskFinished = new Promise<void>((resolve) => {
      releaseTask = resolve;
    });

    const task = enqueueRecognitionTask({
      jobId: "lifecycle-route-test",
      workId: "lifecycle-route-work",
      task: async () => taskFinished,
    });

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));

      const response = GET();

      await expect(response.json()).resolves.toEqual({
        service: "piano-score-coach",
        busy: true,
      });
    } finally {
      releaseTask?.();
      await task;
    }
  });
});
