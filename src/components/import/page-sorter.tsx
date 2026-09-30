"use client";
/* eslint-disable @next/next/no-img-element */

type SortablePage = {
  id: string;
  file: File;
  previewUrl: string | null;
};

type PageSorterProps = {
  pages: SortablePage[];
  onMoveUp: (pageId: string) => void;
  onMoveDown: (pageId: string) => void;
  onRemove: (pageId: string) => void;
};

export function PageSorter({
  pages,
  onMoveUp,
  onMoveDown,
  onRemove,
}: PageSorterProps) {
  if (pages.length === 0) {
    return (
      <div className="page-sorter-empty">
        还没有加入图片页。
      </div>
    );
  }

  return (
    <ol className="page-sorter-list">
      {pages.map((page, index) => (
        <li key={page.id} className="page-sorter-item">
          <div className="page-sorter-preview">
            {page.previewUrl ? (
              <img
                src={page.previewUrl}
                alt={page.file.name}
                width={84}
                height={112}
                loading="lazy"
              />
            ) : (
              <div className="page-sorter-fallback">{page.file.name}</div>
            )}
          </div>
          <div className="page-sorter-copy">
            <strong>{page.file.name}</strong>
            <span>第 {index + 1} 页</span>
          </div>
          <div className="page-sorter-actions">
            <button
              type="button"
              className="secondary-button"
              aria-label={`上移 ${page.file.name}`}
              onClick={() => onMoveUp(page.id)}
              disabled={index === 0}
            >
              上移
            </button>
            <button
              type="button"
              className="secondary-button"
              aria-label={`下移 ${page.file.name}`}
              onClick={() => onMoveDown(page.id)}
              disabled={index === pages.length - 1}
            >
              下移
            </button>
            <button
              type="button"
              className="ghost-button danger-button"
              aria-label={`移除 ${page.file.name}`}
              onClick={() => onRemove(page.id)}
            >
              移除
            </button>
          </div>
        </li>
      ))}
    </ol>
  );
}

export type { SortablePage };
