// @vitest-environment node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

const sourceProjectDir = process.cwd();
const sourceLauncherPath = path.join(sourceProjectDir, "启动陪练.command");
const sourceCloserPath = path.join(sourceProjectDir, "关闭陪练.command");

type LauncherSandbox = {
  projectDir: string;
  launcherPath: string;
  closerPath: string;
  outsideDir: string;
  homeDir: string;
  tempDir: string;
  cwdRecordPath: string;
  argsRecordPath: string;
  pnpmCountPath: string;
  serviceReadyPath: string;
};

const tempDirs: string[] = [];

function writeExecutable(filePath: string, body: string) {
  fs.writeFileSync(filePath, body, { mode: 0o755 });
}

function createLauncherSandbox(): LauncherSandbox {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "piano-score-launcher-"));
  const projectDir = path.join(tempDir, "project");
  const binDir = path.join(tempDir, "bin");
  const homeDir = path.join(tempDir, "home");
  const outsideDir = path.join(tempDir, "outside");
  const cwdRecordPath = path.join(tempDir, "pnpm.cwd");
  const argsRecordPath = path.join(tempDir, "pnpm.args");
  const pnpmCountPath = path.join(tempDir, "pnpm.count");
  const serviceReadyPath = path.join(tempDir, "service.ready");

  tempDirs.push(tempDir);

  fs.mkdirSync(projectDir, { recursive: true });
  fs.mkdirSync(path.join(projectDir, "scripts"), { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  fs.mkdirSync(homeDir, { recursive: true });
  fs.mkdirSync(outsideDir, { recursive: true });

  fs.copyFileSync(sourceLauncherPath, path.join(projectDir, "启动陪练.command"));
  fs.copyFileSync(sourceCloserPath, path.join(projectDir, "关闭陪练.command"));
  fs.copyFileSync(
    path.join(sourceProjectDir, "scripts", "piano-coach-supervisor.mjs"),
    path.join(projectDir, "scripts", "piano-coach-supervisor.mjs"),
  );

  writeExecutable(
    path.join(binDir, "pnpm"),
    `#!/bin/sh
printf '%s' "$PWD" > "$TEST_PNPM_CWD_FILE"
printf '%s' "$*" > "$TEST_PNPM_ARGS_FILE"
count=0
if [ -f "$TEST_PNPM_COUNT_FILE" ]; then
  count=$(cat "$TEST_PNPM_COUNT_FILE")
fi
printf '%s' "$((count + 1))" > "$TEST_PNPM_COUNT_FILE"
: > "$TEST_SERVICE_READY_FILE"
/bin/sleep 5
`,
  );

  writeExecutable(
    path.join(binDir, "curl"),
    `#!/bin/sh
if [ "\${TEST_CURL_EXIT_CODE:-0}" -ne 0 ] || [ ! -f "$TEST_SERVICE_READY_FILE" ]; then
  exit 1
fi
printf '%s' '{"service":"piano-score-coach","busy":false}'
`,
  );

  writeExecutable(
    path.join(binDir, "lsof"),
    `#!/bin/sh
if [ -n "\${TEST_LSOF_PID:-}" ]; then
  printf '%s\n' "$TEST_LSOF_PID"
fi
exit 0
`,
  );

  writeExecutable(
    path.join(binDir, "open"),
    `#!/bin/sh
exit 0
`,
  );

  writeExecutable(
    path.join(binDir, "sleep"),
    `#!/bin/sh
/bin/sleep 0.01
`,
  );

  fs.writeFileSync(path.join(homeDir, ".zprofile"), "");
  fs.writeFileSync(path.join(homeDir, ".zshrc"), "");

  return {
    projectDir,
    launcherPath: path.join(projectDir, "启动陪练.command"),
    closerPath: path.join(projectDir, "关闭陪练.command"),
    outsideDir,
    homeDir,
    tempDir,
    cwdRecordPath,
    argsRecordPath,
    pnpmCountPath,
    serviceReadyPath,
  };
}

function sandboxEnvironment(
  sandbox: LauncherSandbox,
  overrides: Record<string, string> = {},
) {
  return {
    ...process.env,
    HOME: sandbox.homeDir,
    PATH: `${path.join(sandbox.tempDir, "bin")}:${process.env.PATH ?? ""}`,
    PIANO_COACH_PORT: "34567",
    TEST_PNPM_CWD_FILE: sandbox.cwdRecordPath,
    TEST_PNPM_ARGS_FILE: sandbox.argsRecordPath,
    TEST_PNPM_COUNT_FILE: sandbox.pnpmCountPath,
    TEST_SERVICE_READY_FILE: sandbox.serviceReadyPath,
    ...overrides,
  };
}

function runLauncher(
  sandbox: LauncherSandbox,
  overrides: Record<string, string> = {},
) {
  return spawnSync("/bin/zsh", [sandbox.launcherPath], {
    cwd: sandbox.outsideDir,
    encoding: "utf8",
    env: sandboxEnvironment(sandbox, overrides),
    input: "\n",
  });
}

function runCloser(
  sandbox: LauncherSandbox,
  overrides: Record<string, string> = {},
) {
  return spawnSync("/bin/zsh", [sandbox.closerPath], {
    cwd: sandbox.outsideDir,
    encoding: "utf8",
    env: sandboxEnvironment(sandbox, overrides),
    input: "\n",
  });
}

afterEach(async () => {
  for (const tempDir of tempDirs.splice(0)) {
    const runtimeDir = path.join(tempDir, "project", ".runtime");

    for (const pidFileName of [
      "piano-score-coach.pid",
      "piano-score-coach.server.pid",
    ]) {
      const pidFile = path.join(runtimeDir, pidFileName);

      if (!fs.existsSync(pidFile)) {
        continue;
      }

      const pid = Number(fs.readFileSync(pidFile, "utf8").trim());

      if (Number.isInteger(pid) && pid > 1) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          // The sandbox process already exited.
        }
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

describe("launcher scripts", () => {
  it("runs pnpm from the project directory even when started elsewhere", () => {
    const sandbox = createLauncherSandbox();

    const result = runLauncher(sandbox);
    const logPath = path.join(
      sandbox.projectDir,
      ".runtime",
      "piano-score-coach.log",
    );
    const diagnostics = `${result.stdout}${result.stderr}\n${
      fs.existsSync(logPath) ? fs.readFileSync(logPath, "utf8") : ""
    }\ncwd-record=${fs.existsSync(sandbox.cwdRecordPath)} args-record=${fs.existsSync(
      sandbox.argsRecordPath,
    )} ready=${fs.existsSync(sandbox.serviceReadyPath)}`;

    expect(result.status, diagnostics).toBe(0);
    expect(fs.readFileSync(sandbox.cwdRecordPath, "utf8")).toBe(sandbox.projectDir);
    expect(fs.readFileSync(sandbox.argsRecordPath, "utf8")).toContain(
      "dev --hostname 127.0.0.1 --port 34567",
    );
  });

  it("reuses the running service when the single launcher is opened again", () => {
    const sandbox = createLauncherSandbox();

    expect(runLauncher(sandbox).status).toBe(0);
    expect(runLauncher(sandbox).status).toBe(0);

    expect(fs.readFileSync(sandbox.pnpmCountPath, "utf8")).toBe("1");
  });

  it("lets the maintenance closer stop the launcher-owned supervisor", () => {
    const sandbox = createLauncherSandbox();
    const startResult = runLauncher(sandbox);

    expect(startResult.status).toBe(0);

    const closeResult = runCloser(sandbox);
    const output = `${closeResult.stdout}${closeResult.stderr}`;

    expect(closeResult.status).toBe(0);
    expect(output).toContain("陪练服务已经关闭。");
    expect(
      fs.existsSync(
        path.join(sandbox.projectDir, ".runtime", "piano-score-coach.pid"),
      ),
    ).toBe(false);
  });

  it("does not take over an unrelated listener on the configured port", () => {
    const sandbox = createLauncherSandbox();

    const result = runLauncher(sandbox, { TEST_LSOF_PID: "424242" });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "端口正被其他程序占用",
    );
    expect(fs.existsSync(sandbox.cwdRecordPath)).toBe(false);
    expect(fs.existsSync(sandbox.argsRecordPath)).toBe(false);
  });

  it("does not crash its zsh exit trap on startup failure", () => {
    const sandbox = createLauncherSandbox();

    const result = runLauncher(sandbox, { TEST_CURL_EXIT_CODE: "1" });
    const output = `${result.stdout}${result.stderr}`;

    expect(result.status).toBe(1);
    expect(output).toContain("服务启动超时。");
    expect(output).not.toContain("read-only variable: status");
  });
});
