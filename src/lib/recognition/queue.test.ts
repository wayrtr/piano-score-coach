// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  cancelQueuedRecognitionTasksForWork,
  enqueueRecognitionTask,
  getRecognitionQueueSnapshot,
  getRecognitionQueueState,
} from "@/lib/recognition/queue";

afterEach(async () => {
  getRecognitionQueueState().queue.start();
  await getRecognitionQueueState().queue.onIdle();
  expect(getRecognitionQueueSnapshot()).toEqual({ queued: [], running: [] });
});

describe("recognition queue", () => {
  it("coalesces running duplicates without hiding the running task", async () => {
    const gate = Promise.withResolvers<string>();
    const firstTask = vi.fn(() => gate.promise);
    const duplicateTask = vi.fn(async () => "duplicate");
    const first = enqueueRecognitionTask({
      jobId: "same-job",
      workId: "same-work",
      task: firstTask,
    });
    const duplicate = enqueueRecognitionTask({
      jobId: "same-job",
      workId: "same-work",
      task: duplicateTask,
    });

    try {
      expect(getRecognitionQueueSnapshot()).toEqual({
        queued: [],
        running: [{ jobId: "same-job", workId: "same-work" }],
      });
      cancelQueuedRecognitionTasksForWork("same-work");
      expect(getRecognitionQueueSnapshot().running).toHaveLength(1);
    } finally {
      gate.resolve("recognized");
      await Promise.all([first, duplicate]);
    }

    await expect(first).resolves.toBe("recognized");
    await expect(duplicate).resolves.toBe("recognized");
    expect(firstTask).toHaveBeenCalledTimes(1);
    expect(duplicateTask).not.toHaveBeenCalled();
  });

  it("coalesces queued duplicates and allows a fresh run after completion", async () => {
    const state = getRecognitionQueueState();
    state.queue.pause();
    const task = vi.fn(async () => "recognized");
    const first = enqueueRecognitionTask({ jobId: "queued", workId: "work", task });
    const duplicate = enqueueRecognitionTask({ jobId: "queued", workId: "work", task });

    expect(state.queue.size).toBe(1);
    expect(getRecognitionQueueSnapshot().queued).toHaveLength(1);
    state.queue.start();

    await expect(first).resolves.toBe("recognized");
    await expect(duplicate).resolves.toBe("recognized");
    expect(task).toHaveBeenCalledTimes(1);

    await enqueueRecognitionTask({ jobId: "queued", workId: "work", task });
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("does not revive cancelled jobs when their ID is reused", async () => {
    const state = getRecognitionQueueState();
    state.queue.pause();
    const cancelledTask = vi.fn(async () => "cancelled");
    const replacementTask = vi.fn(async () => "replacement");
    const cancelled = enqueueRecognitionTask({
      jobId: "reused",
      workId: "work",
      task: cancelledTask,
    });
    cancelQueuedRecognitionTasksForWork("work");
    const replacement = enqueueRecognitionTask({
      jobId: "reused",
      workId: "work",
      task: replacementTask,
    });

    state.queue.start();

    await expect(cancelled).resolves.toBeUndefined();
    await expect(replacement).resolves.toBe("replacement");
    expect(cancelledTask).not.toHaveBeenCalled();
    expect(replacementTask).toHaveBeenCalledTimes(1);
  });

  it("propagates one rejection to duplicate callers and releases the job ID", async () => {
    const state = getRecognitionQueueState();
    state.queue.pause();
    const failure = new Error("recognition failed");
    const task = vi.fn(async () => { throw failure; });
    const first = enqueueRecognitionTask({ jobId: "failed", workId: "work", task });
    const duplicate = enqueueRecognitionTask({ jobId: "failed", workId: "work", task });
    const results = Promise.allSettled([first, duplicate]);
    state.queue.start();

    expect(await results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    expect(task).toHaveBeenCalledTimes(1);
    await expect(enqueueRecognitionTask({
      jobId: "failed",
      workId: "work",
      task: async () => "recovered",
    })).resolves.toBe("recovered");
  });

  it("cancels only queued jobs for the selected work and keeps serial execution", async () => {
    const gate = Promise.withResolvers<void>();
    const running = enqueueRecognitionTask({
      jobId: "running",
      workId: "work",
      task: () => gate.promise,
    });
    const cancelledTask = vi.fn(async () => undefined);
    const otherTask = vi.fn(async () => "other");
    const cancelled = enqueueRecognitionTask({
      jobId: "cancelled",
      workId: "work",
      task: cancelledTask,
    });
    const other = enqueueRecognitionTask({
      jobId: "other",
      workId: "other-work",
      task: otherTask,
    });

    try {
      cancelQueuedRecognitionTasksForWork("work");
      expect(getRecognitionQueueSnapshot()).toEqual({
        queued: [{ jobId: "other", workId: "other-work" }],
        running: [{ jobId: "running", workId: "work" }],
      });
      expect(otherTask).not.toHaveBeenCalled();
    } finally {
      gate.resolve();
      await Promise.all([running, cancelled, other]);
    }

    expect(cancelledTask).not.toHaveBeenCalled();
    expect(otherTask).toHaveBeenCalledTimes(1);
  });
});
