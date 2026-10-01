// @vitest-environment node

import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { recognizeScoreWithAudiveris } from "@/lib/recognition/audiveris";

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn }));

describe("Audiveris process lifecycle", () => {
  let root: string;
  let child: ReturnType<typeof createChild>;
  const platform = Object.getOwnPropertyDescriptor(process, "platform")!;

  beforeEach(() => {
    vi.useFakeTimers();
    root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-audiveris-lifecycle-"));
    child = createChild();
    spawn.mockReturnValue(child);
    vi.stubEnv("AUDIVERIS_COMMAND", "fake-audiveris");
    vi.spyOn(process, "kill").mockReturnValue(true);
    Object.defineProperty(process, "platform", { ...platform, value: "linux" });
  });

  afterEach(() => {
    child.stdout.destroy();
    child.stderr.destroy();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    Object.defineProperty(process, "platform", platform);
    fs.rmSync(root, { recursive: true, force: true });
  });

  function recognize() {
    return recognizeScoreWithAudiveris({
      inputPath: path.join(root, "score.pdf"),
      outputRoot: path.join(root, "output"),
      timeoutMs: 100,
    });
  }

  it("bounds a timeout even when descendants never close inherited pipes", async () => {
    const result = expect(recognize()).rejects.toThrow("识别超时");

    await vi.advanceTimersByTimeAsync(100);
    expect(spawn).toHaveBeenCalledWith("fake-audiveris", expect.any(Array), expect.objectContaining({ detached: true }));
    expect(process.kill).toHaveBeenCalledWith(-child.pid, "SIGTERM");

    await vi.advanceTimersByTimeAsync(5_000);
    await result;

    expect(process.kill).toHaveBeenCalledWith(-child.pid, "SIGKILL");
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
    expect(child.unref).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("kills remaining group members when a timed-out launcher closes early", async () => {
    const result = expect(recognize()).rejects.toThrow("识别超时");

    await vi.advanceTimersByTimeAsync(100);
    child.emit("close", null, "SIGTERM");
    await result;

    expect(process.kill).toHaveBeenLastCalledWith(-child.pid, "SIGKILL");
    expect(child.listenerCount("error")).toBe(0);
    expect(child.stdout.listenerCount("data")).toBe(0);
    expect(child.stderr.listenerCount("data")).toBe(0);
    expect(child.listenerCount("close")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("still releases pipes and rejects if the process group is already gone", async () => {
    vi.mocked(process.kill).mockImplementation(() => {
      throw Object.assign(new Error("no such process"), { code: "ESRCH" });
    });
    const result = expect(recognize()).rejects.toThrow("识别超时");

    await vi.advanceTimersByTimeAsync(5_100);
    await result;

    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("uses child-only signals and a bounded pipe teardown on Windows", async () => {
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    const result = expect(recognize()).rejects.toThrow("识别超时");

    await vi.advanceTimersByTimeAsync(5_100);
    await result;

    expect(spawn).toHaveBeenCalledWith("fake-audiveris", expect.any(Array), expect.objectContaining({ detached: false }));
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    expect(process.kill).not.toHaveBeenCalled();
    expect(child.stdout.destroyed).toBe(true);
    expect(child.stderr.destroyed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears timeout resources after a successful export", async () => {
    const result = recognize();
    const scorePath = path.join(root, "output", "score.musicxml");
    fs.writeFileSync(scorePath, "<score-partwise/>");
    child.stdout.write("recognized");
    child.emit("close", 0, null);

    await expect(result).resolves.toMatchObject({ musicXmlPath: scorePath, stdout: "recognized" });
    expect(process.kill).not.toHaveBeenCalled();
    expect(child.listenerCount("error")).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    { code: "ENOENT", message: "未找到 Audiveris" },
    { code: "EACCES", message: "没有运行权限" },
  ])("preserves the friendly $code error and clears its timer", async ({ code, message }) => {
    const result = expect(recognize()).rejects.toThrow(message);
    child.emit("error", Object.assign(new Error(code), { code }));
    child.emit("close", -1, null);

    await result;
    expect(process.kill).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});

function createChild() {
  return Object.assign(new EventEmitter(), {
    pid: 12345,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(() => true),
    unref: vi.fn(),
  });
}
