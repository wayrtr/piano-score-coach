import fs from "node:fs";
import path from "node:path";

export type WorkStoragePaths = {
  workRoot: string;
  sourceRoot: string;
  pagesRoot: string;
  derivedRoot: string;
};

export function ensureDirectory(directoryPath: string) {
  fs.mkdirSync(directoryPath, { recursive: true });
  return directoryPath;
}

export function getWorkStoragePaths(
  storageRoot: string,
  workId: string,
): WorkStoragePaths {
  const workRoot = path.join(storageRoot, "works", workId);

  return {
    workRoot,
    sourceRoot: path.join(workRoot, "source"),
    pagesRoot: path.join(workRoot, "pages"),
    derivedRoot: path.join(workRoot, "derived"),
  };
}

export function ensureWorkStoragePaths(
  storageRoot: string,
  workId: string,
): WorkStoragePaths {
  const paths = getWorkStoragePaths(storageRoot, workId);

  ensureDirectory(paths.workRoot);
  ensureDirectory(paths.sourceRoot);
  ensureDirectory(paths.pagesRoot);
  ensureDirectory(paths.derivedRoot);

  return paths;
}

export function getWorkPageImagePath(
  storageRoot: string,
  workId: string,
  fileName: string,
) {
  return path.join(getWorkStoragePaths(storageRoot, workId).pagesRoot, fileName);
}

export function removeWorkStoragePaths(storageRoot: string, workId: string) {
  const { workRoot } = getWorkStoragePaths(storageRoot, workId);
  fs.rmSync(workRoot, { recursive: true, force: true });
}
