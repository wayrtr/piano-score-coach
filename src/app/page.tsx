import { ImportForm } from "@/components/import/import-form";
import { listWorks } from "@/lib/works/query";

// The local SQLite library changes independently of Next's build/cache.
export const dynamic = "force-dynamic";

export default function HomePage() {
  const works = listWorks();

  return (
    <main id="main-content" className="page-shell">
      <ImportForm initialWorks={works} />
    </main>
  );
}
