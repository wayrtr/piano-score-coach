import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { vi } from "vitest";

import { ScoreToolbar, ScoreView } from "@/components/practice/score-view";
import type { PracticePage } from "@/lib/practice/types";

vi.mock("@/components/practice/musicxml-score-view", () => ({
  MusicXmlScoreView: () => <p>MusicXML 谱面渲染中</p>,
}));

const demoPages: PracticePage[] = [
  {
    id: "page_1",
    pageIndex: 0,
    renderMode: "image",
    imageSrc: "/scores/work/page-1.png",
    imageWidth: 1000,
    imageHeight: 1400,
    recognitionStatus: "succeeded",
    objects: [
      {
        id: "obj_page_1_main",
        type: "note",
        bbox: { x: 100, y: 120, width: 40, height: 32 },
        staff: "treble",
        measure: 1,
        notes: ["E4"],
        confidence: 0.94,
        source: "model",
      },
      {
        id: "obj_page_1_low",
        type: "chord",
        bbox: { x: 320, y: 480, width: 60, height: 50 },
        staff: "grand",
        measure: 4,
        notes: ["C4", "E4", "G4"],
        confidence: 0.42,
        source: "model",
      },
      {
        id: "obj_page_1_next_bass",
        type: "note",
        bbox: { x: 322, y: 620, width: 36, height: 34 },
        staff: "bass",
        measure: 4,
        notes: ["C3"],
        confidence: 0.9,
        source: "model",
      },
    ],
  },
  {
    id: "page_2",
    pageIndex: 1,
    renderMode: "image",
    imageSrc: "/scores/work/page-2.png",
    imageWidth: 900,
    imageHeight: 1300,
    recognitionStatus: "succeeded",
    objects: [
      {
        id: "obj_page_2_main",
        type: "note",
        bbox: { x: 180, y: 210, width: 36, height: 30 },
        staff: "bass",
        measure: 7,
        notes: ["A3"],
        confidence: 0.88,
        source: "model",
      },
    ],
  },
];

function ScoreViewHarness() {
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  return (
    <>
      <ScoreView
        pages={demoPages}
        currentPageIndex={currentPageIndex}
        selectedObjectId={selectedObjectId}
        zoom={zoom}
        onPageChange={setCurrentPageIndex}
        onSelectObject={(selection) => {
          setCurrentPageIndex(selection.pageIndex);
          setSelectedObjectId(selection.objectId);
        }}
        onZoomChange={setZoom}
      />
      <output aria-label="当前页">{currentPageIndex + 1}</output>
      <output aria-label="当前选中对象">{selectedObjectId ?? "none"}</output>
      <output aria-label="当前缩放">{zoom}</output>
    </>
  );
}

describe("ScoreView", () => {
  it("renders optional toolbar content beside the page indicator", () => {
    render(
      <ScoreView
        pages={demoPages}
        currentPageIndex={0}
        selectedObjectId={null}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
        toolbarContent={<button type="button">播放</button>}
      />,
    );

    const pageIndicator = screen.getByText("第 1 / 2 页");
    expect(pageIndicator.closest(".score-toolbar-page-controls")).toContainElement(
      screen.getByRole("button", { name: "播放" }),
    );
  });

  it("can place the same page and zoom controls above the score", () => {
    function HeaderHarness() {
      const [pageIndex, setPageIndex] = useState(0);
      const [zoom, setZoom] = useState(1);
      return (
        <>
          <header><ScoreToolbar pages={demoPages} currentPageIndex={pageIndex} zoom={zoom}
            onPageChange={setPageIndex} onZoomChange={setZoom} /></header>
          <ScoreView pages={demoPages} currentPageIndex={pageIndex} selectedObjectId={null}
            zoom={zoom} onPageChange={setPageIndex} onZoomChange={setZoom}
            onSelectObject={() => undefined} showToolbar={false} />
        </>
      );
    }

    const { container } = render(<HeaderHarness />);
    expect(container.querySelector(".score-card .practice-toolbar")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "放大谱面" }));
    expect(screen.getByRole("button", { name: "重置缩放" })).toHaveTextContent("125%");
  });

  it("selects an object when the hotspot is clicked", () => {
    render(<ScoreViewHarness />);

    fireEvent.click(screen.getByRole("button", { name: "定位到第 1 页第 1 小节 E4" }));

    expect(screen.getByLabelText("当前选中对象")).toHaveTextContent(
      "obj_page_1_main",
    );
  });

  it("does not move the page when a visible score object is selected", async () => {
    render(<ScoreViewHarness />);
    const hotspot = screen.getByTestId("hotspot-obj_page_1_main");
    const stage = hotspot.closest(".score-stage") as HTMLDivElement;
    const scrollIntoView = vi.fn();
    const scrollTo = vi.fn();

    Object.defineProperty(hotspot, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(stage, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });
    stage.getBoundingClientRect = vi.fn(() =>
      ({ top: 0, right: 600, bottom: 420, left: 0 } as DOMRect),
    );
    hotspot.getBoundingClientRect = vi.fn(() =>
      ({ top: 100, right: 140, bottom: 132, left: 100 } as DOMRect),
    );
    fireEvent.click(hotspot);

    await waitFor(() => {
      expect(screen.getByLabelText("当前选中对象")).toHaveTextContent(
        "obj_page_1_main",
      );
    });
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("reveals an offscreen image hotspot inside the score viewport", async () => {
    render(<ScoreViewHarness />);
    const hotspot = screen.getByTestId("hotspot-obj_page_1_low");
    const stage = hotspot.closest(".score-stage") as HTMLDivElement;
    const scrollTo = vi.fn();

    Object.defineProperties(stage, {
      clientHeight: { configurable: true, value: 420 },
      clientWidth: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1400 },
      scrollWidth: { configurable: true, value: 1000 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    stage.getBoundingClientRect = vi.fn(() =>
      ({ top: 0, right: 600, bottom: 420, left: 0 } as DOMRect),
    );
    hotspot.getBoundingClientRect = vi.fn(() =>
      ({ top: 900, right: 380, bottom: 950, left: 320 } as DOMRect),
    );

    fireEvent.click(hotspot);

    await waitFor(() => {
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ top: 715 }),
      );
    });
  });

  it("moves between pages with next and previous controls", () => {
    render(<ScoreViewHarness />);

    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(screen.getByLabelText("当前页")).toHaveTextContent("2");
    expect(screen.getByText("第 2 / 2 页")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    expect(screen.getByLabelText("当前页")).toHaveTextContent("1");
  });

  it("rescales hotspot overlays when zoom changes without clearing selection", () => {
    render(<ScoreViewHarness />);

    fireEvent.click(screen.getByRole("button", { name: "定位到第 1 页第 1 小节 E4" }));
    const hotspot = screen.getByTestId("hotspot-obj_page_1_main");

    expect(hotspot).toHaveStyle({
      width: "40px",
    });

    fireEvent.click(screen.getByRole("button", { name: "放大谱面" }));

    expect(screen.getByLabelText("当前选中对象")).toHaveTextContent(
      "obj_page_1_main",
    );
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("1.25");
    expect(hotspot).toHaveStyle({
      width: "50px",
    });
  });

  it("shows zoom percentages and disables zooming beyond either boundary", () => {
    render(<ScoreViewHarness />);

    const zoomOut = screen.getByRole("button", { name: "缩小谱面" });
    const zoomIn = screen.getByRole("button", { name: "放大谱面" });
    expect(screen.getByText("100%")).toBeInTheDocument();

    fireEvent.click(zoomOut);
    fireEvent.click(zoomOut);
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(zoomOut).toBeDisabled();
    expect(zoomIn).toBeEnabled();
    fireEvent.click(zoomOut);
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("0.5");

    for (let step = 0; step < 8; step += 1) {
      fireEvent.click(zoomIn);
    }
    expect(screen.getByText("250%")).toBeInTheDocument();
    expect(zoomIn).toBeDisabled();
    expect(zoomOut).toBeEnabled();
    fireEvent.click(zoomIn);
    expect(screen.getByLabelText("当前缩放")).toHaveTextContent("2.5");
  });

  it("does not expose the removed low-confidence review workflow", () => {
    render(<ScoreViewHarness />);

    expect(
      screen.queryByRole("button", { name: "显示低置信度对象" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("hotspot-obj_page_1_low")).toHaveClass(
      "is-low-confidence",
    );
  });

  it("keeps difficult objects visibly marked and announced", () => {
    render(
      <ScoreView
        pages={demoPages}
        currentPageIndex={0}
        selectedObjectId={null}
        difficultObjectIds={["obj_page_1_low"]}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
      />,
    );

    const hotspot = screen.getByTestId("hotspot-obj_page_1_low");

    expect(hotspot).toHaveClass("is-difficult");
    expect(hotspot).toHaveAccessibleName("定位到第 1 页第 4 小节 C4 E4 G4，已标记难点");
  });

  it("marks the next score event without selecting it", () => {
    render(
      <ScoreView
        pages={demoPages}
        currentPageIndex={0}
        selectedObjectId="obj_page_1_main"
        previewObjectIds={["obj_page_1_low", "obj_page_1_next_bass"]}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("hotspot-obj_page_1_main")).toHaveClass("is-selected");
    expect(screen.getByTestId("hotspot-obj_page_1_low")).toHaveClass("is-preview");
    expect(screen.getByTestId("hotspot-obj_page_1_low")).toHaveAccessibleName(
      "定位到第 1 页第 4 小节 C4 E4 G4，下一音",
    );
    expect(screen.getByTestId("hotspot-obj_page_1_next_bass")).toHaveClass("is-preview");
    expect(screen.getByTestId("hotspot-obj_page_1_next_bass")).toHaveAccessibleName(
      "定位到第 1 页第 4 小节 C3，下一音",
    );
  });

  it("highlights every object in the current grand-staff event", () => {
    render(
      <ScoreView
        pages={demoPages}
        currentPageIndex={0}
        selectedObjectId="obj_page_1_low"
        selectedObjectIds={["obj_page_1_low", "obj_page_1_next_bass"]}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
      />,
    );

    expect(screen.getByTestId("hotspot-obj_page_1_low")).toHaveClass("is-selected");
    expect(screen.getByTestId("hotspot-obj_page_1_next_bass")).toHaveClass(
      "is-selected",
    );
  });

  it("renders a dedicated MusicXML stage when the practice page comes from structured notation", () => {
    render(
      <ScoreView
        pages={[
          {
            id: "musicxml_page_1",
            pageIndex: 0,
            renderMode: "musicxml",
            musicXmlSrc: "/api/works/work_1/musicxml",
            measureStart: 1,
            measureEnd: 8,
            recognitionStatus: "succeeded",
            objects: [
              {
                id: "mxo-m0001-s1-v1-o0001",
                type: "chord",
                bbox: { x: 0, y: 0, width: 1, height: 1 },
                staff: "treble",
                measure: 1,
                notes: ["E4", "G4"],
                confidence: 1,
                source: "model",
              },
            ],
          },
        ]}
        currentPageIndex={0}
        selectedObjectId={null}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
      />,
    );

    expect(screen.getByText("MusicXML 谱面渲染中")).toBeInTheDocument();
  });

  it("keeps the original scan reachable beside a derived MusicXML score", () => {
    render(
      <ScoreView
        pages={[
          {
            id: "omr_page_1",
            pageIndex: 0,
            renderMode: "musicxml",
            musicXmlSrc: "/api/works/work_1/pages/omr_page_1/musicxml",
            fallbackImageSrc: "/api/works/work_1/pages/omr_page_1/image",
            measureStart: 1,
            measureEnd: 8,
            recognitionStatus: "succeeded",
            objects: [],
          },
        ]}
        currentPageIndex={0}
        selectedObjectId={null}
        zoom={1}
        onPageChange={() => undefined}
        onSelectObject={() => undefined}
        onZoomChange={() => undefined}
      />,
    );

    expect(screen.getByRole("link", { name: "查看原图" })).toHaveAttribute(
      "href",
      "/api/works/work_1/pages/omr_page_1/image",
    );
  });
});
