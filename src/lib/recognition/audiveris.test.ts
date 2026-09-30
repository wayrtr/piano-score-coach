import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { recognizeScoreWithAudiveris } from "@/lib/recognition/audiveris";

describe("recognizeScoreWithAudiveris", () => {
  beforeEach(() => {
    for (const name of ["AUDIVERIS_COMMAND", "FAKE_AUDIVERIS_MXL_SOURCE", "FAKE_AUDIVERIS_ARGS_PATH"]) {
      vi.stubEnv(name, process.env[name]);
    }
    vi.spyOn(process, "cwd").mockReturnValue(
      fs.mkdtempSync(path.join(os.tmpdir(), "piano-audiveris-project-")),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("turns a normalized score into a local MXL file", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-audiveris-"));
    const inputPath = path.join(root, "- score page.pdf");
    const outputRoot = path.join(root, "output folder");
    const sourceMxlPath = path.join(root, "fixture.mxl");
    const fakeAudiverisPath = path.join(root, "fake-audiveris.mjs");
    const argsPath = path.join(root, "audiveris-args.json");

    fs.writeFileSync(inputPath, "normalized page");
    fs.writeFileSync(sourceMxlPath, "fake mxl");
    fs.writeFileSync(
      fakeAudiverisPath,
      `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outputIndex = args.indexOf("-output");
const outputRoot = args[outputIndex + 1];

fs.mkdirSync(outputRoot, { recursive: true });
fs.copyFileSync(process.env.FAKE_AUDIVERIS_MXL_SOURCE, path.join(outputRoot, "recognized.mxl"));
fs.writeFileSync(process.env.FAKE_AUDIVERIS_ARGS_PATH, JSON.stringify(args));
process.stdout.write("Audiveris test runner");
`,
    );
    fs.chmodSync(fakeAudiverisPath, 0o755);

    process.env.AUDIVERIS_COMMAND = fakeAudiverisPath;
    process.env.FAKE_AUDIVERIS_MXL_SOURCE = sourceMxlPath;
    process.env.FAKE_AUDIVERIS_ARGS_PATH = argsPath;

    try {
      const result = await recognizeScoreWithAudiveris({
        inputPath,
        outputRoot,
      });

      expect(result).toMatchObject({
        engine: "audiveris",
        musicXmlPath: path.join(outputRoot, "recognized.mxl"),
      });
      expect(fs.readFileSync(result.musicXmlPath, "utf8")).toBe("fake mxl");
      expect(result.stdout).toContain("Audiveris test runner");
      expect(JSON.parse(fs.readFileSync(argsPath, "utf8"))).toEqual([
        "-batch",
        "-transcribe",
        "-export",
        "-output",
        outputRoot,
        "--",
        inputPath,
      ]);
    } finally {
      delete process.env.AUDIVERIS_COMMAND;
      delete process.env.FAKE_AUDIVERIS_MXL_SOURCE;
      delete process.env.FAKE_AUDIVERIS_ARGS_PATH;
    }
  });

  it("fails safely instead of discarding extra movement files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-audiveris-movements-"));
    const inputPath = path.join(root, "score.pdf");
    const outputRoot = path.join(root, "output");
    const fakeAudiverisPath = path.join(root, "fake-audiveris.mjs");

    fs.writeFileSync(inputPath, "normalized score");
    fs.writeFileSync(
      fakeAudiverisPath,
      `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const outputRoot = args[args.indexOf("-output") + 1];

fs.mkdirSync(outputRoot, { recursive: true });
fs.writeFileSync(path.join(outputRoot, "score.mvt1.mxl"), "movement one");
fs.writeFileSync(path.join(outputRoot, "score.mvt2.mxl"), "movement two");
`,
    );
    fs.chmodSync(fakeAudiverisPath, 0o755);
    process.env.AUDIVERIS_COMMAND = fakeAudiverisPath;

    try {
      await expect(
        recognizeScoreWithAudiveris({
          inputPath,
          outputRoot,
        }),
      ).rejects.toThrow("生成了 2 份乐谱文件");
    } finally {
      delete process.env.AUDIVERIS_COMMAND;
    }
  });

  it("rejects a successful process that did not export a score", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "piano-audiveris-empty-"));
    const inputPath = path.join(root, "score.pdf");
    const outputRoot = path.join(root, "output");
    const fakeAudiverisPath = path.join(root, "fake-audiveris.mjs");

    fs.writeFileSync(inputPath, "normalized score");
    fs.writeFileSync(
      fakeAudiverisPath,
      `#!/usr/bin/env node
process.exit(0);
`,
    );
    fs.chmodSync(fakeAudiverisPath, 0o755);
    process.env.AUDIVERIS_COMMAND = fakeAudiverisPath;

    try {
      await expect(
        recognizeScoreWithAudiveris({
          inputPath,
          outputRoot,
        }),
      ).rejects.toThrow("没有生成 MusicXML 或 MXL 文件");
    } finally {
      delete process.env.AUDIVERIS_COMMAND;
    }
  });

  it("uses complete project OCR models without changing the parent environment", async () => {
    const tessdataPath = path.join(process.cwd(), ".runtime", "tessdata");
    fs.mkdirSync(tessdataPath, { recursive: true });
    for (const language of ["eng", "chi_sim"]) {
      fs.writeFileSync(path.join(tessdataPath, `${language}.traineddata`), "fixture");
    }
    vi.stubEnv("TESSDATA_PREFIX", undefined);

    const received = await captureAudiverisConfiguration();

    expect(received.tessdataPrefix).toBe(tessdataPath);
    expect(received.args).toContain(
      "org.audiveris.omr.text.Language.defaultSpecification=chi_sim+eng",
    );
    expect(received.args.indexOf("-constant")).toBeLessThan(received.args.indexOf("--"));
    expect(process.env.TESSDATA_PREFIX).toBeUndefined();
  });

  it.each([
    { cache: "missing", prefix: undefined },
    { cache: "partial", prefix: undefined },
    { cache: "directory", prefix: undefined },
    { cache: "complete", prefix: "/custom/ocr-models" },
    { cache: "complete", prefix: "" },
  ])("preserves existing OCR behavior for $cache cache and prefix $prefix", async ({ cache, prefix }) => {
    const tessdataPath = path.join(process.cwd(), ".runtime", "tessdata");
    if (cache !== "missing") {
      fs.mkdirSync(tessdataPath, { recursive: true });
      fs.writeFileSync(path.join(tessdataPath, "eng.traineddata"), "fixture");
      if (cache === "complete") {
        fs.writeFileSync(path.join(tessdataPath, "chi_sim.traineddata"), "fixture");
      } else if (cache === "directory") {
        fs.mkdirSync(path.join(tessdataPath, "chi_sim.traineddata"));
      }
    }
    vi.stubEnv("TESSDATA_PREFIX", prefix);

    const received = await captureAudiverisConfiguration();

    expect(received.tessdataPrefix).toBe(prefix);
    expect(received.args).not.toContain("-constant");
  });
});

async function captureAudiverisConfiguration() {
  const root = process.cwd();
  const commandPath = path.join(root, "capture-audiveris.mjs");
  fs.writeFileSync(commandPath, `#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
fs.writeFileSync(path.join(args[args.indexOf("-output") + 1], "score.mxl"), "fixture");
process.stdout.write(JSON.stringify({ args, tessdataPrefix: process.env.TESSDATA_PREFIX }));
`);
  fs.chmodSync(commandPath, 0o755);
  vi.stubEnv("AUDIVERIS_COMMAND", commandPath);
  const result = await recognizeScoreWithAudiveris({
    inputPath: path.join(root, "score.pdf"),
    outputRoot: path.join(root, "output"),
  });
  return JSON.parse(result.stdout) as { args: string[]; tessdataPrefix?: string };
}
