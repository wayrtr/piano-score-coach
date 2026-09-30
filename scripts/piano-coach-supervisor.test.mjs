// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { evaluateIdleTransition } from "./piano-coach-supervisor.mjs";

const tempDirs = [];

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

function createSupervisorSandbox() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piano-supervisor-"));
  const projectDir = path.join(tempDir, "project");
  const binDir = path.join(tempDir, "bin");
  const serviceScript = path.join(tempDir, "fake-service.mjs");
  const runtimeDir = path.join(projectDir, ".runtime");

  tempDirs.push(tempDir);
  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });

  fs.writeFileSync(
    serviceScript,
    `import http from "node:http";
import fs from "node:fs";

const portIndex = process.argv.indexOf("--port");
const port = Number(process.argv[portIndex + 1]);
const writeHeartbeat = () => {
  fs.writeFileSync(process.env.PIANO_COACH_HEARTBEAT_FILE, String(Date.now()));
};
writeHeartbeat();
const heartbeatTimer = setInterval(writeHeartbeat, 30);
let statusChecks = 0;
const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200).end();
    return;
  }

  if (request.url === "/stop-heartbeats") {
    clearInterval(heartbeatTimer);
    response.writeHead(200).end();
    return;
  }

  if (request.url !== "/api/lifecycle/heartbeat") {
    response.writeHead(404).end();
    return;
  }

  statusChecks += 1;
  fs.writeFileSync(process.env.TEST_STATUS_CHECK_FILE, String(statusChecks));
  if (process.env.TEST_RESUME_HEARTBEAT === "1" && statusChecks === 1) {
    writeHeartbeat();
  }

  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify({ service: "piano-score-coach", busy: false }));
});

server.listen(port, "127.0.0.1");
process.once("SIGTERM", () => {
  server.close();
  process.exit(0);
});
`,
  );

  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/bin/sh
exec "$TEST_REAL_NODE" "$TEST_SERVICE_SCRIPT" "$@"
`,
  );

  return {
    tempDir,
    projectDir,
    binDir,
    runtimeDir,
    serviceScript,
  };
}

function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        // The child already exited.
      }
      reject(new Error("后台管理器没有在预期时间内退出"));
    }, timeoutMs);

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);
      resolve({ code, signal });
    });
  });
}

async function waitForHealth(port) {
  const url = `http://127.0.0.1:${port}/health`;

  for (let attempt = 0; attempt < 300; attempt += 1) {
    try {
      const response = await fetch(url);

      if (response.ok) {
        return;
      }
    } catch {
      // The fake service is still starting.
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("测试服务没有启动");
}

async function findAvailablePort() {
  const server = createServer();

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;

  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

  if (!port) {
    throw new Error("无法分配测试端口");
  }

  return port;
}

describe("piano coach supervisor", () => {
  it.each([
    ["process.exit(0)", { code: 0, signal: null }],
    ['process.kill(process.pid, "SIGTERM")', { code: null, signal: "SIGTERM" }],
  ])("captures an earlier exit: %s", async (script, result) => {
    const child = spawn(process.execPath, ["-e", script], { stdio: "ignore" });

    await new Promise((resolve) => child.once("exit", resolve));

    await expect(waitForExit(child, 100)).resolves.toEqual(result);
  });

  it("adds a grace period before reclaiming a stale service", () => {
    const firstCheck = evaluateIdleTransition({
      now: 1_000_000,
      previousCheckAt: 970_000,
      lastHeartbeatAt: 0,
      idleTimeoutMs: 900_000,
      graceMs: 90_000,
      wakeThresholdMs: 120_000,
      candidate: null,
    });

    expect(firstCheck).toEqual({
      action: "wait",
      candidate: {
        heartbeatAt: 0,
        since: 1_000_000,
      },
    });

    expect(
      evaluateIdleTransition({
        now: 1_090_000,
        previousCheckAt: 1_060_000,
        lastHeartbeatAt: 0,
        idleTimeoutMs: 900_000,
        graceMs: 90_000,
        wakeThresholdMs: 120_000,
        candidate: firstCheck.candidate,
      }),
    ).toEqual({
      action: "check-busy",
      candidate: firstCheck.candidate,
    });
  });

  it.each([false, true])("reclaims idle services (resume=%s)", async (resume) => {
    const sandbox = createSupervisorSandbox();
    const port = await findAvailablePort();
    const supervisor = spawn(
      process.execPath,
      [path.join(process.cwd(), "scripts", "piano-coach-supervisor.mjs")],
      {
        cwd: sandbox.projectDir,
        env: {
          ...process.env,
          PATH: `${sandbox.binDir}:${process.env.PATH ?? ""}`,
          PIANO_COACH_PROJECT_DIR: sandbox.projectDir,
          PIANO_COACH_RUNTIME_DIR: sandbox.runtimeDir,
          PIANO_COACH_PORT: String(port),
          PIANO_COACH_IDLE_TIMEOUT_SECONDS: "0.15",
          PIANO_COACH_IDLE_GRACE_SECONDS: "0.12",
          PIANO_COACH_WATCH_INTERVAL_SECONDS: "0.04",
          TEST_REAL_NODE: process.execPath,
          TEST_SERVICE_SCRIPT: sandbox.serviceScript,
          TEST_STATUS_CHECK_FILE: path.join(sandbox.tempDir, "status-checks"),
          TEST_RESUME_HEARTBEAT: resume ? "1" : "0",
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    supervisor.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    supervisor.stderr.on("data", (chunk) => {
      output += chunk.toString();
    });

    try {
      await waitForHealth(port);
    } catch (error) {
      supervisor.kill("SIGKILL");
      throw new Error(`${error.message}\n${output}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 250));
    const runningWithHeartbeat =
      supervisor.exitCode === null && supervisor.signalCode === null;

    let result;

    try {
      await fetch(`http://127.0.0.1:${port}/stop-heartbeats`);
      result = await waitForExit(supervisor);
    } catch (error) {
      throw new Error(`${error.message}\n${output}`);
    }

    expect(runningWithHeartbeat, output).toBe(true);
    expect(result.code).toBe(0);
    expect(output).toContain("陪练页面已关闭并持续空闲");
    if (resume) {
      const statusChecks = Number(
        fs.readFileSync(path.join(sandbox.tempDir, "status-checks"), "utf8"),
      );
      expect(statusChecks).toBeGreaterThanOrEqual(2);
    }
    expect(
      fs.existsSync(path.join(sandbox.runtimeDir, "piano-score-coach.pid")),
    ).toBe(false);
  }, 10_000);
});

afterEach(() => {
  for (const tempDir of tempDirs.splice(0)) {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
