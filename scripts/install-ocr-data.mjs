// One-time setup: node scripts/install-ocr-data.mjs
// Official Apache-2.0 models supporting Audiveris's legacy OCR engine.
// Source: https://github.com/tesseract-ocr/tessdata
// Ordinary score imports never run this installer or download models.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

const revision = "ced78752cc61322fb554c280d13360b35b8684e4";
const models = [
  { language: "eng", size: 23466654, gitBlob: "f4744c201359d02ced6914c77f0de68ee9bbdd74" },
  { language: "chi_sim", size: 44366093, gitBlob: "eeb66cfbd9c02b170a6aeeece673910793d8d8c4" },
];
const root = join(dirname(fileURLToPath(import.meta.url)), "..", ".runtime", "tessdata");

async function matchesModel(filePath, model) {
  let buffer;
  try {
    buffer = await readFile(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  // Git's blob digest verifies the exact file at the pinned official revision.
  return buffer.length === model.size && createHash("sha1")
    .update(`blob ${buffer.length}\0`)
    .update(buffer)
    .digest("hex") === model.gitBlob;
}

try {
  await mkdir(root, { recursive: true });
  for (const model of models) {
    const destination = join(root, `${model.language}.traineddata`);
    if (await matchesModel(destination, model)) {
      console.log(`${model.language}: 已存在且校验通过。`);
      continue;
    }
    const partial = `${destination}.${process.pid}.partial`;
    const url = `https://raw.githubusercontent.com/tesseract-ocr/tessdata/${revision}/${model.language}.traineddata`;
    try {
      console.log(`${model.language}: 正在下载官方 OCR 模型（${(model.size / 1_000_000).toFixed(1)} MB）…`);
      const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      await pipeline(Readable.fromWeb(response.body), createWriteStream(partial, { flags: "wx" }));
      if (!await matchesModel(partial, model)) {
        throw new Error("下载文件的大小或校验值与官方固定版本不符");
      }
      await rename(partial, destination);
      console.log(`${model.language}: 校验通过，已保存至 ${destination}`);
    } catch (error) {
      throw new Error(`${model.language} 安装失败：${error.message}${error.cause?.message ? `（${error.cause.message}）` : ""}`, { cause: error });
    } finally {
      await rm(partial, { force: true });
    }
  }
  console.log("OCR 模型准备完成。导入时将从项目缓存读取，不会联网下载。");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
