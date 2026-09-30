import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SERVICE_NAME = "piano-score-coach";
const DEFAULT_IDLE_TIMEOUT_SECONDS = 900;
const DEFAULT_IDLE_GRACE_SECONDS = 90;
const DEFAULT_WATCH_INTERVAL_SECONDS = 30;

export function evaluateIdleTransition({
  now,
  previousCheckAt,
  lastHeartbeatAt,
  idleTimeoutMs,
  graceMs,
  wakeThresholdMs,
  candidate,
}) {
  if (now - lastHeartbeatAt < idleTimeoutMs) {
    return {
      action: "wait",
      candidate: null,
    };
  }

  const resumedAfterSleep =
    previousCheckAt !== null && now - previousCheckAt > wakeThresholdMs;
  const heartbeatChanged = candidate?.heartbeatAt !== lastHeartbeatAt;

  if (resumedAfterSleep || heartbeatChanged || candidate === null) {
    return {
      action: "wait",
      candidate: {
        heartbeatAt: lastHeartbeatAt,
        since: now,
      },
    };
  }

  if (now - candidate.since < graceMs) {
    return {
      action: "wait",
      candidate,
    };
  }

  return {
    action: "check-busy",
    candidate,
  };
}

export function readPositiveSeconds(value, fallback) {
  const parsed = Number(value);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function readHeartbeatTimestamp(heartbeatFile, fallback) {
  try {
    const timestamp = Number(fs.readFileSync(heartbeatFile, "utf8").trim());

    return Number.isFinite(timestamp) && timestamp >= 0 ? timestamp : fallback;
  } catch {
    return fallback;
  }
}

function removeOwnedFile(filePath, expectedValue) {
  try {
    if (fs.readFileSync(filePath, "utf8").trim() === String(expectedValue)) {
      fs.rmSync(filePath, { force: true });
    }
  } catch {
    // The file was already removed or belonged to another instance.
  }
}

function signalProcessGroup(pid, signal) {
  if (!pid) {
    return;
  }

  for (const target of [-pid, pid]) {
    try {
      process.kill(target, signal);
    } catch (error) {
      if (error?.code !== "ESRCH") {
        throw error;
      }
    }
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readServiceStatus(url) {
  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      return null;
    }

    const body = await response.json();

    if (body?.service !== SERVICE_NAME || typeof body.busy !== "boolean") {
      return null;
    }

    return body;
  } catch {
    return null;
  }
}

export async function runSupervisor(environment = process.env) {
  const projectDir = environment.PIANO_COACH_PROJECT_DIR ?? process.cwd();
  const runtimeDir =
    environment.PIANO_COACH_RUNTIME_DIR ?? path.join(projectDir, ".runtime");
  const port = String(environment.PIANO_COACH_PORT ?? "3000");
  const idleTimeoutMs =
    readPositiveSeconds(
      environment.PIANO_COACH_IDLE_TIMEOUT_SECONDS,
      DEFAULT_IDLE_TIMEOUT_SECONDS,
    ) * 1_000;
  const graceMs =
    readPositiveSeconds(
      environment.PIANO_COACH_IDLE_GRACE_SECONDS,
      DEFAULT_IDLE_GRACE_SECONDS,
    ) * 1_000;
  const watchIntervalMs =
    readPositiveSeconds(
      environment.PIANO_COACH_WATCH_INTERVAL_SECONDS,
      DEFAULT_WATCH_INTERVAL_SECONDS,
    ) * 1_000;
  const wakeThresholdMs = Math.max(watchIntervalMs * 4, 120_000);
  const pidFile = path.join(runtimeDir, "piano-score-coach.pid");
  const serverPidFile = path.join(runtimeDir, "piano-score-coach.server.pid");
  const heartbeatFile = path.join(runtimeDir, "piano-score-coach.heartbeat");
  const lifecycleUrl = `http://127.0.0.1:${port}/api/lifecycle/heartbeat`;
  const startedAt = Date.now();

  fs.mkdirSync(runtimeDir, { recursive: true });
  fs.writeFileSync(pidFile, `${process.pid}\n`, "utf8");
  fs.writeFileSync(heartbeatFile, `${startedAt}\n`, "utf8");

  const server = spawn(
    "pnpm",
    ["dev", "--hostname", "127.0.0.1", "--port", port],
    {
      cwd: projectDir,
      detached: true,
      env: {
        ...environment,
        PIANO_COACH_HEARTBEAT_FILE: heartbeatFile,
      },
      stdio: "inherit",
    },
  );

  if (server.pid) {
    fs.writeFileSync(serverPidFile, `${server.pid}\n`, "utf8");
  }

  let stopping = false;
  let childExited = false;
  let checkInProgress = false;
  let previousCheckAt = startedAt;
  let candidate = null;
  let timer;

  const childExit = new Promise((resolve) => {
    server.once("exit", (code, signal) => {
      childExited = true;
      resolve({ code, signal });
    });
  });

  function cleanupRuntimeFiles() {
    let ownsRuntime = false;

    try {
      ownsRuntime =
        fs.readFileSync(pidFile, "utf8").trim() === String(process.pid);
    } catch {
      ownsRuntime = false;
    }

    if (!ownsRuntime) {
      return;
    }

    removeOwnedFile(serverPidFile, server.pid);
    fs.rmSync(heartbeatFile, { force: true });
    fs.rmSync(pidFile, { force: true });
  }

  async function shutdown(exitCode, reason) {
    if (stopping) {
      return;
    }

    stopping = true;
    clearInterval(timer);

    if (reason) {
      console.log(reason);
    }

    if (!childExited && server.pid) {
      signalProcessGroup(server.pid, "SIGTERM");

      await Promise.race([childExit, delay(10_000)]);

      if (!childExited) {
        signalProcessGroup(server.pid, "SIGKILL");
        await Promise.race([childExit, delay(1_000)]);
      }
    }

    cleanupRuntimeFiles();
    process.exit(exitCode);
  }

  async function checkIdle() {
    if (stopping || checkInProgress) {
      return;
    }

    const now = Date.now();
    const lastHeartbeatAt = readHeartbeatTimestamp(heartbeatFile, startedAt);
    const transition = evaluateIdleTransition({
      now,
      previousCheckAt,
      lastHeartbeatAt,
      idleTimeoutMs,
      graceMs,
      wakeThresholdMs,
      candidate,
    });

    previousCheckAt = now;
    candidate = transition.candidate;

    if (transition.action !== "check-busy") {
      return;
    }

    checkInProgress = true;
    const status = await readServiceStatus(lifecycleUrl);
    checkInProgress = false;

    if (readHeartbeatTimestamp(heartbeatFile, startedAt) !== lastHeartbeatAt) {
      candidate = null;
      return;
    }

    if (!status || status.busy) {
      candidate = {
        heartbeatAt: lastHeartbeatAt,
        since: Date.now(),
      };
      return;
    }

    await shutdown(0, "陪练页面已关闭并持续空闲，服务已自动退出。");
  }

  timer = setInterval(() => {
    void checkIdle();
  }, watchIntervalMs);

  server.once("error", (error) => {
    console.error(`无法启动陪练服务：${error.message}`);
    void shutdown(1);
  });

  void childExit.then(({ code, signal }) => {
    if (stopping) {
      return;
    }

    cleanupRuntimeFiles();
    console.log(
      `陪练服务已退出（${signal ? `信号 ${signal}` : `代码 ${code ?? 0}`}）。`,
    );
    process.exit(code ?? (signal ? 1 : 0));
  });

  process.once("SIGTERM", () => {
    void shutdown(0, "正在关闭陪练服务…");
  });
  process.once("SIGINT", () => {
    void shutdown(0, "正在关闭陪练服务…");
  });
  process.once("exit", () => {
    clearInterval(timer);
    cleanupRuntimeFiles();

    if (!childExited && server.pid) {
      try {
        signalProcessGroup(server.pid, "SIGTERM");
      } catch {
        // Process exit cleanup must stay best-effort.
      }
    }
  });

  return {
    server,
    heartbeatFile,
    pidFile,
    serverPidFile,
  };
}

const isMainModule =
  process.argv[1] !== undefined &&
  fs.realpathSync(fileURLToPath(import.meta.url)) ===
    fs.realpathSync(path.resolve(process.argv[1]));

if (isMainModule) {
  runSupervisor().catch((error) => {
    console.error(`陪练后台管理器启动失败：${error.message}`);
    process.exit(1);
  });
}
