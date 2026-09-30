"use client";

import Link from "next/link";
import {
  ArrowRight,
  FileImage,
  FileMusic,
  FileText,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import {
  startTransition,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type SyntheticEvent,
} from "react";

import {
  PageSorter,
  type SortablePage,
} from "@/components/import/page-sorter";
import { getWorkStatusLabel } from "@/lib/ui/labels";
import { GlassSurface } from "@/components/glass-surface";

export type WorkListItem = {
  id: string;
  title: string;
  sourceType: string;
  pageCount: number;
  status: string;
  lastPracticedAt: string | null;
  lastPageIndex?: number | null;
  lastObjectId?: string | null;
  lastMeasure?: number | null;
  instrumentMode?: string | null;
  pages: Array<{
    id: string;
    pageIndex: number;
    recognitionStatus: string;
  }>;
};

type ImportFormProps = {
  initialWorks: WorkListItem[];
};

export function ImportForm({ initialWorks }: ImportFormProps) {
  const [title, setTitle] = useState("");
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [musicXmlFile, setMusicXmlFile] = useState<File | null>(null);
  const [imagePages, setImagePages] = useState<SortablePage[]>([]);
  const [works, setWorks] = useState(initialWorks);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusRefreshError, setStatusRefreshError] = useState<string | null>(
    null,
  );
  const [workActionError, setWorkActionError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDeletingWorkId, setIsDeletingWorkId] = useState<string | null>(null);
  const [deleteCandidateId, setDeleteCandidateId] = useState<string | null>(
    null,
  );
  const [isImportOpen, setIsImportOpen] = useState(initialWorks.length === 0);
  const [isAlternativeImportOpen, setIsAlternativeImportOpen] = useState(false);
  const imagePagesRef = useRef(imagePages);
  const submitAbortControllerRef = useRef<AbortController | null>(null);
  const worksRequestVersionRef = useRef(0);
  const pdfInputRef = useRef<HTMLInputElement | null>(null);
  const musicXmlInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const worksHeadingRef = useRef<HTMLHeadingElement | null>(null);
  const deleteCancelButtonRef = useRef<HTMLButtonElement | null>(null);
  const deleteTriggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const hasPendingWork = hasPendingRecognition(works);

  useEffect(() => {
    if (!hasPendingWork) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | undefined;

    async function pollWorks() {
      const requestVersion = ++worksRequestVersionRef.current;

      try {
        const payload = await fetchWorks();

        if (!cancelled && requestVersion === worksRequestVersionRef.current) {
          setStatusRefreshError(null);
          startTransition(() => {
            setWorks(payload);
          });
        }
      } catch {
        if (!cancelled && requestVersion === worksRequestVersionRef.current) {
          setStatusRefreshError("状态暂时没刷新，可以稍后重试。");
        }
      } finally {
        if (!cancelled) {
          timeoutId = window.setTimeout(() => void pollWorks(), 2000);
        }
      }
    }

    timeoutId = window.setTimeout(() => void pollWorks(), 2000);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [hasPendingWork]);

  useEffect(() => {
    imagePagesRef.current = imagePages;
  }, [imagePages]);

  useEffect(() => {
    if (!deleteCandidateId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      deleteCancelButtonRef.current?.focus();
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [deleteCandidateId]);

  useEffect(() => {
    return () => {
      imagePagesRef.current.forEach((page) => {
        revokePreviewUrl(page.previewUrl);
      });
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (submitAbortControllerRef.current) {
      return;
    }

    setErrorMessage(null);

    const sourceType = musicXmlFile
      ? "musicxml"
      : pdfFile
        ? "pdf"
        : imagePages.length > 0
          ? "images"
          : null;

    if (!sourceType) {
      setErrorMessage("请先选择一份 MusicXML、PDF，或者加入多张图片页。");
      return;
    }

    const formData = new FormData();

    if (title.trim()) {
      formData.set("title", title.trim());
    }

    formData.set("sourceType", sourceType);

    if (sourceType === "pdf" && pdfFile) {
      formData.set("pdf", pdfFile);
    }

    if (sourceType === "musicxml" && musicXmlFile) {
      formData.set("musicxml", musicXmlFile);
    }

    if (sourceType === "images") {
      imagePages.forEach((page) => {
        formData.append("images", page.file);
      });
    }

    setIsSubmitting(true);
    const abortController = new AbortController();
    submitAbortControllerRef.current = abortController;
    worksRequestVersionRef.current += 1;

    try {
      const response = await fetch("/api/works", {
        method: "POST",
        body: formData,
        signal: abortController.signal,
      });

      if (!response.ok) {
        setErrorMessage(await readResponseErrorMessage(response));
        return;
      }

      const payload = await readResponseJson<{
        works: WorkListItem[];
      }>(response);

      if (!payload || !Array.isArray(payload.works)) {
        setErrorMessage("导入完成后返回内容异常，请刷新后再看一次。");
        return;
      }

      worksRequestVersionRef.current += 1;
      startTransition(() => {
        setWorks(payload.works);
      });

      clearSelectedFiles();
      setTitle("");
      setIsImportOpen(false);
      setStatusRefreshError(null);
    } catch (error) {
      if (isAbortError(error)) {
        setErrorMessage("已取消导入，已选择的文件仍保留。");
        setStatusRefreshError("如果服务端已经开始处理，乐谱可能稍后出现在列表中。");
        void refreshWorks();
      } else {
        setErrorMessage("导入失败，请稍后再试。");
      }
    } finally {
      if (submitAbortControllerRef.current === abortController) {
        submitAbortControllerRef.current = null;
      }
      setIsSubmitting(false);
    }
  }

  function cancelSubmit() {
    submitAbortControllerRef.current?.abort();
  }

  function handlePdfChange(files: FileList | null) {
    const file = files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!isPdfFile(file)) {
      setErrorMessage("这个文件不是 PDF，请重新选择一份谱子。");
      return;
    }

    setErrorMessage(null);

    setPdfFile(file);
    setMusicXmlFile(null);
    if (musicXmlInputRef.current) {
      musicXmlInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setIsAlternativeImportOpen(true);
    setImagePages((currentPages) => {
      currentPages.forEach((page) => {
        revokePreviewUrl(page.previewUrl);
      });

      return [];
    });

    if (!title.trim()) {
      setTitle(deriveTitle(file.name));
    }
  }

  function handleImageChange(files: FileList | null) {
    if (!files || files.length === 0) {
      return;
    }

    const invalidFile = Array.from(files).find((file) => !isImageFile(file));

    if (invalidFile) {
      setErrorMessage(`“${invalidFile.name}”不是图片，请重新选择。`);
      return;
    }

    setErrorMessage(null);

    setPdfFile(null);
    setMusicXmlFile(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
    if (musicXmlInputRef.current) {
      musicXmlInputRef.current.value = "";
    }
    setIsAlternativeImportOpen(true);
    setImagePages((currentPages) => [
      ...currentPages,
      ...Array.from(files).map((file) => ({
        id: createClientId(),
        file,
        previewUrl: createPreviewUrl(file),
      })),
    ]);
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }

    if (!title.trim()) {
      setTitle(deriveTitle(files[0].name));
    }
  }

  function handleMusicXmlChange(files: FileList | null) {
    const file = files?.[0] ?? null;

    if (!file) {
      return;
    }

    if (!isMusicXmlFile(file)) {
      setErrorMessage("这个文件不是 MusicXML，请选择 .musicxml、.xml 或 .mxl 文件。");
      return;
    }

    setErrorMessage(null);

    setMusicXmlFile(file);
    setPdfFile(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setIsAlternativeImportOpen(false);
    setImagePages((currentPages) => {
      currentPages.forEach((page) => {
        revokePreviewUrl(page.previewUrl);
      });

      return [];
    });

    if (!title.trim()) {
      setTitle(deriveTitle(file.name));
    }
  }

  function movePage(pageId: string, direction: -1 | 1) {
    setImagePages((currentPages) => {
      const index = currentPages.findIndex((page) => page.id === pageId);

      if (index < 0) {
        return currentPages;
      }

      const nextIndex = index + direction;

      if (nextIndex < 0 || nextIndex >= currentPages.length) {
        return currentPages;
      }

      const pages = [...currentPages];
      const [page] = pages.splice(index, 1);
      pages.splice(nextIndex, 0, page);

      return pages;
    });
  }

  function removePage(pageId: string) {
    setImagePages((currentPages) => {
      const page = currentPages.find((item) => item.id === pageId);

      if (page) {
        revokePreviewUrl(page.previewUrl);
      }

      return currentPages.filter((item) => item.id !== pageId);
    });
  }

  function clearSelectedFiles() {
    setPdfFile(null);
    setMusicXmlFile(null);
    if (pdfInputRef.current) {
      pdfInputRef.current.value = "";
    }
    if (musicXmlInputRef.current) {
      musicXmlInputRef.current.value = "";
    }
    if (imageInputRef.current) {
      imageInputRef.current.value = "";
    }
    setImagePages((currentPages) => {
      currentPages.forEach((page) => {
        revokePreviewUrl(page.previewUrl);
      });

      return [];
    });
  }

  async function handleDeleteWork(workId: string) {
    worksRequestVersionRef.current += 1;
    setWorkActionError(null);
    setIsDeletingWorkId(workId);

    try {
      const response = await fetch(`/api/works/${workId}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        setWorkActionError(
          await readResponseErrorMessage(response, "删除作品失败，请稍后再试。"),
        );
        return;
      }

      worksRequestVersionRef.current += 1;
      startTransition(() => {
        setWorks((currentWorks) => currentWorks.filter((work) => work.id !== workId));
      });
      setDeleteCandidateId(null);
      window.requestAnimationFrame(() => worksHeadingRef.current?.focus());
    } catch {
      setWorkActionError("删除作品失败，请检查本地服务后再试。原作品仍然保留。");
    } finally {
      setIsDeletingWorkId(null);
    }
  }

  async function refreshWorks() {
    const requestVersion = ++worksRequestVersionRef.current;
    setIsRefreshing(true);

    try {
      const nextWorks = await fetchWorks();

      if (requestVersion === worksRequestVersionRef.current) {
        setWorks(nextWorks);
        setStatusRefreshError(null);
        setWorkActionError(null);
      }
    } catch {
      if (requestVersion === worksRequestVersionRef.current) {
        setStatusRefreshError("状态暂时没刷新，可以稍后重试。");
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  function requestDeleteWork(workId: string) {
    setWorkActionError(null);
    setDeleteCandidateId(workId);
  }

  function cancelDeleteWork() {
    const workId = deleteCandidateId;

    setDeleteCandidateId(null);
    window.requestAnimationFrame(() => {
      if (workId) {
        deleteTriggerRefs.current.get(workId)?.focus();
      }
    });
  }

  function handleDetailsToggle(
    event: SyntheticEvent<HTMLDetailsElement>,
    setter: (open: boolean) => void,
  ) {
    setter(event.currentTarget.open);
  }

  const selectedSource = getSelectedSource({
    musicXmlFile,
    pdfFile,
    imagePageCount: imagePages.length,
  });

  return (
    <div className="dashboard-grid dashboard-home">
      <header className="home-heading">
        <h1 id="works-heading" ref={worksHeadingRef} tabIndex={-1}>我的乐谱</h1>
        {works.length > 0 ? (
          <button
            type="button"
            className={`ghost-button icon-button${isRefreshing ? " is-refreshing" : ""}`}
            aria-label={isRefreshing ? "刷新中…" : "刷新状态"}
            title="刷新状态"
            onClick={() => void refreshWorks()}
            disabled={isRefreshing}
          >
            <RefreshCw size={17} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <GlassSurface as="section" className="panel-card works-panel glass-panel" aria-labelledby="works-heading">
        {statusRefreshError ? (
          <p className="inline-error" role="status">
            {statusRefreshError} <button type="button" className="text-button" onClick={() => void refreshWorks()}>再试一次</button>
          </p>
        ) : null}

        {workActionError ? (
          <p className="inline-error" role="alert">{workActionError}</p>
        ) : null}

        {works.length === 0 ? (
          <div className="empty-state">还没有作品，先导入一首试试。</div>
        ) : (
          <ul className="work-list">
            {works.map((work) => (
              <li key={work.id} className="work-list-item" data-status={work.status}>
                <Link
                  className="work-main work-open-link"
                  href={`/works/${work.id}`}
                  aria-label={`${getPrimaryActionLabel(work)}：${work.title}`}
                >
                  <span className="work-artwork" aria-hidden="true">
                    <FileMusic size={24} strokeWidth={1.5} />
                  </span>
                  <div className="work-copy">
                    <strong>{work.title}</strong>
                    <p>{work.pageCount} 页</p>
                  </div>
                  <ArrowRight className="work-open-arrow" size={18} aria-hidden="true" />
                </Link>
                <div className="work-actions">
                  {deleteCandidateId === work.id ? (
                    <div
                      className="delete-confirmation"
                      role="alertdialog"
                      aria-label={`确认删除 ${work.title}`}
                      aria-describedby={`delete-message-${work.id}`}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          cancelDeleteWork();
                        }
                      }}
                    >
                      <span id={`delete-message-${work.id}`}>删除后会移除本机缓存，确定吗？</span>
                      <button
                        type="button"
                        className="ghost-button danger-button"
                        disabled={isDeletingWorkId === work.id}
                        onClick={() => void handleDeleteWork(work.id)}
                      >
                        {isDeletingWorkId === work.id ? "删除中…" : "确认删除"}
                      </button>
                      <button
                        ref={deleteCancelButtonRef}
                        type="button"
                        className="ghost-button"
                        disabled={isDeletingWorkId === work.id}
                        onClick={cancelDeleteWork}
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      ref={(element) => {
                        if (element) {
                          deleteTriggerRefs.current.set(work.id, element);
                        } else {
                          deleteTriggerRefs.current.delete(work.id);
                        }
                      }}
                      type="button"
                      className="ghost-button danger-button icon-button"
                      aria-label={`删除 ${work.title}`}
                      title={`删除 ${work.title}`}
                      disabled={isDeletingWorkId === work.id}
                      onClick={() => requestDeleteWork(work.id)}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                    </button>
                  )}
                </div>
                {work.status !== "ready" ? (
                  <div className="work-status-message" role="status">
                    <span className={`status-pill status-${work.status}`}>
                      {getWorkStatusLabel(work.status)}
                    </span>
                    <span>{describeWorkStatus(work)}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </GlassSurface>

      <details
        className="panel-card import-panel import-panel-collapsible"
        open={isImportOpen}
        onToggle={(event) => handleDetailsToggle(event, setIsImportOpen)}
      >
        <summary className="import-summary">
          <span className="import-heading">
            <span className="import-artwork" aria-hidden="true">
              <Upload size={22} strokeWidth={1.5} />
            </span>
            <strong>导入乐谱</strong>
          </span>
        </summary>

        <div className="import-panel-content">
          <form className="import-form" onSubmit={handleSubmit}>
            <fieldset
              className="import-form"
              aria-label="导入设置"
              disabled={isSubmitting}
              style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
            >
              <label className="field">
                <span>作品标题（可选）</span>
                <input
                  name="work-title"
                  autoComplete="off"
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="例如：Moon River…"
                />
              </label>

              <div className="source-selection-summary" aria-live="polite">
                {selectedSource ? (
                  <>
                    <span>已选择：{selectedSource}</span>
                    <button type="button" className="text-button" onClick={clearSelectedFiles}>
                      清空选择
                    </button>
                  </>
                ) : (
                  <span>建议先选 MusicXML，能直接保留音符和小节联动。</span>
                )}
              </div>

              <div className="upload-grid">
                <label className={`upload-card upload-card-primary${musicXmlFile ? " is-selected" : ""}`}>
                  <span className="upload-title">
                    <FileMusic size={20} aria-hidden="true" />
                    上传 MusicXML <em>推荐</em>
                  </span>
                  <span className="upload-copy">
                    保留音符和小节，导入后就能点选音符查位置。
                  </span>
                  <input
                    aria-label="上传 MusicXML"
                    className="file-input-visually-hidden"
                    name="musicxml-file"
                    ref={musicXmlInputRef}
                    type="file"
                    accept=".musicxml,.xml,.mxl,application/vnd.recordare.musicxml+xml,application/vnd.recordare.musicxml"
                    onChange={(event) => handleMusicXmlChange(event.target.files)}
                  />
                  <span className="file-picker-button">
                    {musicXmlFile ? "更换 MusicXML 文件" : "选择 MusicXML 文件"}
                  </span>
                  {musicXmlFile ? <strong>{musicXmlFile.name}</strong> : null}
                </label>
              </div>

              <details
                className="secondary-import-options"
                open={isAlternativeImportOpen}
                onToggle={(event) => handleDetailsToggle(event, setIsAlternativeImportOpen)}
              >
                <summary>没有 MusicXML？使用 PDF 或图片</summary>
                <div className="upload-grid upload-grid-secondary">
                  <label className={`upload-card${pdfFile ? " is-selected" : ""}`}>
                    <span className="upload-title">
                      <FileText size={20} aria-hidden="true" />
                      上传 PDF
                    </span>
                    <span className="upload-copy">
                      适合整份乐谱；页图会先整理，再进行识别。
                    </span>
                    <input
                      aria-label="上传 PDF"
                      className="file-input-visually-hidden"
                      name="pdf-file"
                      ref={pdfInputRef}
                      type="file"
                      accept="application/pdf"
                      onChange={(event) => handlePdfChange(event.target.files)}
                    />
                    <span className="file-picker-button">
                      {pdfFile ? "更换 PDF 文件" : "选择 PDF 文件"}
                    </span>
                    {pdfFile ? <strong>{pdfFile.name}</strong> : null}
                  </label>

                  <label className={`upload-card${imagePages.length > 0 ? " is-selected" : ""}`}>
                    <span className="upload-title">
                      <FileImage size={20} aria-hidden="true" />
                      上传多张图片
                    </span>
                    <span className="upload-copy">
                      可以补传缺页；提交前按下面的顺序整理。
                    </span>
                    <input
                      aria-label="上传多张图片"
                      className="file-input-visually-hidden"
                      name="image-files"
                      ref={imageInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(event) => handleImageChange(event.target.files)}
                    />
                    <span className="file-picker-button">
                      {imagePages.length > 0 ? "继续添加图片" : "选择图片"}
                    </span>
                    {imagePages.length > 0 ? (
                      <strong>{imagePages.length} 张图片待提交</strong>
                    ) : null}
                  </label>
                </div>
              </details>

              {imagePages.length > 0 ? (
                <div className="page-sorter-shell">
                  <div className="section-title">
                    <h2>页面顺序</h2>
                    <span>用上移、下移调整顺序后再提交。</span>
                  </div>
                  <PageSorter
                    pages={imagePages}
                    onMoveUp={(pageId) => movePage(pageId, -1)}
                    onMoveDown={(pageId) => movePage(pageId, 1)}
                    onRemove={removePage}
                  />
                </div>
              ) : null}
            </fieldset>

            <details className="privacy-note">
              <summary>隐私与存储</summary>
              <p>PDF 和图片会在本机交给 Audiveris 识别，不会发送给 AI 模型。</p>
              <p>MusicXML 直接在本机解析，无需识别。</p>
              <p>
                使用 PDF 或图片前，请先安装{" "}
                <a
                  href="https://github.com/Audiveris/audiveris/releases"
                  target="_blank"
                  rel="noreferrer"
                >
                  Audiveris 5.11 或更高版本
                </a>
                。
              </p>
              <p>作品数据默认保存在本机磁盘，不会自动同步到云端。</p>
              <p>可以在本地删除已缓存作品和对应页图。</p>
            </details>

            {errorMessage ? <p className="inline-error" role="alert">{errorMessage}</p> : null}

            {isSubmitting ? (
              <div className="import-progress-actions" role="status" aria-live="polite">
                <span>正在准备谱面…</span>
                <button type="button" className="ghost-button" onClick={cancelSubmit}>
                  取消导入
                </button>
              </div>
            ) : (
              <button type="submit" className="primary-button">
                <Upload size={17} aria-hidden="true" />
                开始导入
              </button>
            )}
          </form>
        </div>
      </details>
    </div>
  );
}

function describeWorkStatus(work: WorkListItem) {
  if (work.status !== "failed") {
    const succeeded = work.pages.filter(
      (page) => page.recognitionStatus === "succeeded",
    ).length;
    const pending = Math.max(work.pages.length - succeeded, 0);

    return pending > 0
      ? `已完成 ${succeeded}/${work.pages.length} 页`
      : "正在整理谱面";
  }

  if (work.sourceType === "musicxml") {
    return "未找到可点击音符，可重新导入。";
  }

  return "识别未完成，可检查页图或重新导入。";
}

function getPrimaryActionLabel(work: WorkListItem) {
  if (work.status === "failed") {
    return "查看问题";
  }

  if (work.status === "processing") {
    return "查看进度";
  }

  return work.lastPracticedAt ? "继续查看" : "查看乐谱";
}

function getSelectedSource(input: {
  musicXmlFile: File | null;
  pdfFile: File | null;
  imagePageCount: number;
}) {
  if (input.musicXmlFile) {
    return `MusicXML · ${input.musicXmlFile.name}`;
  }

  if (input.pdfFile) {
    return `PDF · ${input.pdfFile.name}`;
  }

  if (input.imagePageCount > 0) {
    return `${input.imagePageCount} 张图片`;
  }

  return null;
}

function isMusicXmlFile(file: File) {
  return /\.(musicxml|xml|mxl)$/i.test(file.name);
}

function isPdfFile(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

function isImageFile(file: File) {
  return file.type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(file.name);
}

function deriveTitle(fileName: string) {
  const withoutExtension = fileName.replace(/\.[^.]+$/, "");

  return withoutExtension.replace(/^\d+-/, "");
}

function createClientId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `page_${Math.random().toString(36).slice(2, 10)}`;
}

function createPreviewUrl(file: File) {
  if (typeof URL !== "undefined" && "createObjectURL" in URL) {
    return URL.createObjectURL(file);
  }

  return null;
}

function revokePreviewUrl(previewUrl: string | null) {
  if (!previewUrl) {
    return;
  }

  if (typeof URL !== "undefined" && "revokeObjectURL" in URL) {
    URL.revokeObjectURL(previewUrl);
  }
}

async function readResponseJson<T>(response: Response) {
  const text = await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchWorks() {
  const response = await fetch("/api/works");

  if (!response.ok) {
    throw new Error("Unable to refresh works");
  }

  const payload = await readResponseJson<{ works?: WorkListItem[] }>(response);

  if (!payload || !Array.isArray(payload.works)) {
    throw new Error("Invalid works response");
  }

  return payload.works;
}

function isAbortError(error: unknown) {
  return (
    typeof DOMException !== "undefined" &&
    error instanceof DOMException &&
    error.name === "AbortError"
  );
}

async function readResponseErrorMessage(
  response: Response,
  fallback = "导入失败，请稍后再试。",
) {
  const text = await response.text();

  if (!text) {
    return fallback;
  }

  try {
    const payload = JSON.parse(text) as {
      error?: string;
    };

    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    if (!looksLikeHtml(text)) {
      return text.trim();
    }
  }

  return fallback;
}

function looksLikeHtml(value: string) {
  return /^\s*</.test(value);
}

function hasPendingRecognition(works: WorkListItem[]) {
  return works.some(
    (work) =>
      work.status === "processing" ||
      work.pages.some((page) =>
        page.recognitionStatus === "queued" ||
        page.recognitionStatus === "normalizing" ||
        page.recognitionStatus === "recognizing",
      ),
  );
}
