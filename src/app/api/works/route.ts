import { NextResponse } from "next/server";

import { listWorks } from "@/lib/works/query";
import { createImportedWork } from "@/lib/works/service";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    works: listWorks(),
  });
}

export async function POST(request: Request) {
  let sourceLabel = "谱子";

  try {
    const formData = await request.formData();
    const sourceType = formData.get("sourceType");
    const title = formData.get("title");

    if (sourceType !== "pdf" && sourceType !== "images" && sourceType !== "musicxml") {
      return NextResponse.json(
        {
          error: "请选择 MusicXML、PDF 或图片文件。",
        },
        {
          status: 400,
        },
      );
    }

    sourceLabel = sourceType === "musicxml" ? "MusicXML" : sourceType === "pdf" ? "PDF" : "图片";

    const files =
      sourceType === "pdf"
        ? await collectFileEntries(formData.get("pdf"))
        : sourceType === "musicxml"
          ? await collectFileEntries(formData.get("musicxml"))
          : await Promise.all(formData.getAll("images").map(collectFileEntries)).then(
              (entries) => entries.flat(),
            );

    if (files.length === 0) {
      return NextResponse.json(
        {
          error: "请至少选择一个文件后再导入。",
        },
        {
          status: 400,
        },
      );
    }

    const created = await createImportedWork({
      title: typeof title === "string" ? title : null,
      sourceType,
      files,
    });

    return NextResponse.json(
      {
        work: created.work,
        works: listWorks(),
      },
      {
        status: 201,
      },
    );
  } catch {
    return NextResponse.json(
      {
        error: `${sourceLabel} 导入失败。请确认文件能正常打开，或重新导出后再试；若文件正常，请检查本机存储空间。`,
      },
      { status: 500 },
    );
  }
}

async function collectFileEntries(formValue: FormDataEntryValue | null) {
  if (!(formValue instanceof File)) {
    return [];
  }

  return [
    {
      fileName: formValue.name,
      buffer: Buffer.from(await formValue.arrayBuffer()),
    },
  ];
}
