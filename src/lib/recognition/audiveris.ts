import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AUDIVERIS_ADAPTER_VERSION = "audiveris-cli-v1";

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_CAPTURED_OUTPUT_LENGTH = 100_000;

export type AudiverisScoreResult = {
  engine: "audiveris";
  version: typeof AUDIVERIS_ADAPTER_VERSION;
  musicXmlPath: string;
  stdout: string;
  stderr: string;
};

export async function recognizeScoreWithAudiveris(input: {
  inputPath: string;
  outputRoot: string;
  timeoutMs?: number;
}): Promise<AudiverisScoreResult> {
  fs.mkdirSync(input.outputRoot, { recursive: true });

  const command = resolveAudiverisCommand();
  const timeoutMs = input.timeoutMs ?? readConfiguredTimeout();
  const tessdataPath = path.join(process.cwd(), ".runtime", "tessdata");
  const useProjectTessdata =
    process.env.TESSDATA_PREFIX === undefined &&
    ["eng", "chi_sim"].every((language) =>
      fs.statSync(path.join(tessdataPath, `${language}.traineddata`), {
        throwIfNoEntry: false,
      })?.isFile(),
    );
  const { stdout, stderr } = await runAudiverisProcess({
    command,
    args: [
      "-batch",
      "-transcribe",
      "-export",
      "-output",
      input.outputRoot,
      ...(useProjectTessdata
        ? [
            "-constant",
            "org.audiveris.omr.text.Language.defaultSpecification=chi_sim+eng",
          ]
        : []),
      "--",
      input.inputPath,
    ],
    env: useProjectTessdata
      ? { ...process.env, TESSDATA_PREFIX: tessdataPath }
      : process.env,
    timeoutMs,
  });
  const musicXmlPaths = findMusicXmlOutputs(input.outputRoot);

  if (musicXmlPaths.length === 0) {
    throw new Error("Audiveris 运行完成，但没有生成 MusicXML 或 MXL 文件。");
  }

  if (musicXmlPaths.length > 1) {
    throw new Error(
      `Audiveris 生成了 ${musicXmlPaths.length} 份乐谱文件，暂时无法安全合并。原谱仍已保留。`,
    );
  }

  return {
    engine: "audiveris",
    version: AUDIVERIS_ADAPTER_VERSION,
    musicXmlPath: musicXmlPaths[0],
    stdout,
    stderr,
  };
}

export function resolveAudiverisCommand() {
  const configuredCommand =
    process.env.AUDIVERIS_COMMAND?.trim() || process.env.AUDIVERIS_BIN?.trim();

  if (configuredCommand) {
    return configuredCommand;
  }

  const installedCandidates =
    process.platform === "darwin"
      ? [
          "/Applications/Audiveris.app/Contents/MacOS/Audiveris",
          path.join(
            os.homedir(),
            "Applications",
            "Audiveris.app",
            "Contents",
            "MacOS",
            "Audiveris",
          ),
        ]
      : process.platform === "linux"
        ? ["/opt/audiveris/bin/Audiveris", "/usr/local/bin/Audiveris"]
        : process.platform === "win32" && process.env.ProgramFiles
          ? [path.join(process.env.ProgramFiles, "Audiveris", "Audiveris.exe")]
          : [];

  return installedCandidates.find((candidate) => fs.existsSync(candidate)) ?? "Audiveris";
}

function readConfiguredTimeout() {
  const configuredTimeout = Number(process.env.AUDIVERIS_TIMEOUT_MS);

  return Number.isFinite(configuredTimeout) && configuredTimeout > 0
    ? configuredTimeout
    : DEFAULT_TIMEOUT_MS;
}

function runAudiverisProcess(input: {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(input.command, input.args, {
      env: input.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let didTimeOut = false;
    let forceKillTimeoutId: ReturnType<typeof setTimeout> | null = null;
    const timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      didTimeOut = true;
      child.kill("SIGTERM");
      forceKillTimeoutId = setTimeout(() => {
        child.kill("SIGKILL");
      }, 5_000);
      forceKillTimeoutId.unref();
    }, input.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout = appendCapturedOutput(stdout, chunk);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr = appendCapturedOutput(stderr, chunk);
    });
    child.on("error", (error: NodeJS.ErrnoException) => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }
      reject(
        didTimeOut
          ? new Error(
              `Audiveris 识别超时（${Math.ceil(input.timeoutMs / 1000)} 秒），原谱仍已保留。`,
            )
          : error.code === "ENOENT"
            ? new Error(
                "未找到 Audiveris。请先安装 Audiveris，或用 AUDIVERIS_COMMAND 指定可执行文件路径。",
              )
            : error.code === "EACCES"
              ? new Error(
                  "Audiveris 没有运行权限。请检查文件权限和 macOS 的“隐私与安全性”设置。",
                )
              : error,
      );
    });
    child.on("close", (exitCode, signal) => {
      if (forceKillTimeoutId) {
        clearTimeout(forceKillTimeoutId);
      }

      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeoutId);

      if (didTimeOut) {
        reject(
          new Error(
            `Audiveris 识别超时（${Math.ceil(input.timeoutMs / 1000)} 秒），原谱仍已保留。`,
          ),
        );
        return;
      }

      if (exitCode === 0) {
        resolve({ stdout, stderr });
        return;
      }

      const detail = stderr.trim() || stdout.trim();
      const suffix = detail ? ` ${detail.slice(-500)}` : "";
      reject(
        new Error(
          `Audiveris 识别失败（退出码 ${exitCode ?? "null"}${
            signal ? `，信号 ${signal}` : ""
          }）。${suffix}`,
        ),
      );
    });
  });
}

function appendCapturedOutput(current: string, chunk: Buffer | string) {
  const next = `${current}${chunk.toString()}`;

  return next.length <= MAX_CAPTURED_OUTPUT_LENGTH
    ? next
    : next.slice(-MAX_CAPTURED_OUTPUT_LENGTH);
}

function findMusicXmlOutputs(outputRoot: string) {
  return findFilesRecursively(outputRoot)
    .filter((filePath) =>
      [".mxl", ".musicxml", ".xml"].includes(path.extname(filePath).toLowerCase()),
    )
    .toSorted();
}

function findFilesRecursively(root: string): string[] {
  if (!fs.existsSync(root)) {
    return [];
  }

  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(root, entry.name);

    return entry.isDirectory() ? findFilesRecursively(entryPath) : [entryPath];
  });
}
