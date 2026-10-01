import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
export const baselineRevision = "87b4eb4";

export function prepareBaselineModule(name: string, sourcePath: string) {
  const source = execFileSync("git", ["show", `${baselineRevision}:${sourcePath}`], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const directory = path.join(repositoryRoot, "tmp", "benchmarks");
  fs.mkdirSync(directory, { recursive: true });
  const modulePath = path.join(directory, `${name}-before.ts`);
  fs.writeFileSync(modulePath, source);
  return modulePath;
}

export function measureWarmRuns(run: () => unknown) {
  run();
  const samples = Array.from({ length: 7 }, () => {
    const start = performance.now();
    run();
    return performance.now() - start;
  }).sort((a, b) => a - b);
  return {
    medianMs: Number(samples[3].toFixed(3)),
    samplesMs: samples.map((sample) => Number(sample.toFixed(3))),
  };
}

export function writeReport(name: string, results: unknown) {
  const report = {
    baselineRevision,
    node: process.version,
    platform: process.platform,
    architecture: process.arch,
    timing: "Median of 7 timed runs after 1 warm-up per operation; synthetic fixtures, no UI or Audiveris measurement",
    results,
  };
  const directory = path.join(repositoryRoot, "output", "benchmarks");
  fs.mkdirSync(directory, { recursive: true });
  const json = JSON.stringify(report, null, 2);
  fs.writeFileSync(path.join(directory, `${name}.json`), `${json}\n`);
  console.log(json);
}
