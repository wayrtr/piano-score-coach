import { notFound } from "next/navigation";

import { PracticeWorkspace } from "@/components/practice/practice-workspace";
import { getPracticeWorkDetail } from "@/lib/works/practice";

export default async function WorkPracticePage({
  params,
}: {
  params: Promise<{
    workId: string;
  }>;
}) {
  const { workId } = await params;
  const work = getPracticeWorkDetail(workId);

  if (!work) {
    notFound();
  }

  return (
    <main id="main-content" className="page-shell practice-page-shell">
      <PracticeWorkspace initialWork={work} />
    </main>
  );
}
