import { describe, expect, it, vi } from "vitest";

import {
  bindMusicXmlClickTargets,
  resolveMusicXmlClickTarget,
  updateMusicXmlRovingTabIndex,
} from "@/components/practice/musicxml-click-targets";

function buildFixture() {
  document.body.innerHTML = `
    <div data-testid="host">
      <svg>
        <g class="vf-stavenote" id="outer-note">
          <g class="vf-note" id="inner-note">
            <g class="vf-notehead" id="notehead">
              <path id="note-path"></path>
            </g>
          </g>
        </g>
        <g class="vf-stavenote" id="second-note">
          <g class="vf-note" id="second-inner-note">
            <g class="vf-notehead" id="second-notehead">
              <path id="second-note-path"></path>
            </g>
          </g>
        </g>
      </svg>
    </div>
  `;

  return {
    host: document.querySelector("[data-testid='host']") as HTMLDivElement,
    outerNote: document.querySelector<SVGGElement>("#outer-note")!,
    innerNote: document.querySelector<SVGGElement>("#inner-note")!,
    notePath: document.querySelector<SVGPathElement>("#note-path")!,
    secondOuterNote: document.querySelector<SVGGElement>("#second-note")!,
    secondInnerNote: document.querySelector<SVGGElement>("#second-inner-note")!,
  };
}

describe("MusicXML click targets", () => {
  it("promotes inner notehead groups to the enclosing stave note group", () => {
    const { innerNote, outerNote } = buildFixture();

    expect(resolveMusicXmlClickTarget(innerNote)).toBe(outerNote);
  });

  it("selects the object when the rendered note itself is clicked", () => {
    const {
      host,
      outerNote,
      innerNote,
      notePath,
      secondOuterNote,
      secondInnerNote,
    } = buildFixture();
    const onSelectObject = vi.fn();
    const cleanup = bindMusicXmlClickTargets({
      hostElement: host,
      onSelectObject,
      targets: [
        {
          objectId: "mxo-m0002-s1-v1-o0001",
          label: "定位到第 1 页第 2 小节 E5",
          renderedElements: [innerNote, secondInnerNote],
        },
      ],
    });

    expect(outerNote).toHaveClass("musicxml-click-target");
    expect(outerNote).toHaveAttribute(
      "data-musicxml-object-id",
      "mxo-m0002-s1-v1-o0001",
    );
    expect(innerNote).not.toHaveClass("musicxml-click-target");
    expect(outerNote).toHaveAttribute("tabindex", "0");
    expect(secondOuterNote).not.toHaveAttribute("tabindex");

    notePath.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onSelectObject).toHaveBeenCalledWith("mxo-m0002-s1-v1-o0001");

    cleanup();

    expect(outerNote).not.toHaveClass("musicxml-click-target");
    expect(outerNote).not.toHaveAttribute("data-musicxml-object-id");
  });

  it("supports keyboard activation on the decorated stave note group", () => {
    const { host, outerNote, innerNote } = buildFixture();
    const onSelectObject = vi.fn();

    bindMusicXmlClickTargets({
      hostElement: host,
      onSelectObject,
      targets: [
        {
          objectId: "mxo-m0004-s1-v1-o0003",
          label: "定位到第 1 页第 4 小节 F#4",
          renderedElements: [innerNote],
        },
      ],
    });

    outerNote.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    outerNote.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));

    expect(onSelectObject).toHaveBeenCalledTimes(2);
    expect(onSelectObject).toHaveBeenNthCalledWith(1, "mxo-m0004-s1-v1-o0003");
    expect(onSelectObject).toHaveBeenNthCalledWith(2, "mxo-m0004-s1-v1-o0003");
  });

  it("keeps only the selected score object in the page tab order", () => {
    const {
      host,
      outerNote,
      innerNote,
      secondOuterNote,
      secondInnerNote,
    } = buildFixture();

    bindMusicXmlClickTargets({
      hostElement: host,
      selectedObjectId: "object-2",
      onSelectObject: vi.fn(),
      targets: [
        {
          objectId: "object-1",
          label: "第一个音",
          renderedElements: [innerNote],
        },
        {
          objectId: "object-2",
          label: "第二个音",
          renderedElements: [secondInnerNote],
        },
      ],
    });

    expect(outerNote).toHaveAttribute("tabindex", "-1");
    expect(secondOuterNote).toHaveAttribute("tabindex", "0");

    updateMusicXmlRovingTabIndex(host, "object-1");

    expect(outerNote).toHaveAttribute("tabindex", "0");
    expect(secondOuterNote).toHaveAttribute("tabindex", "-1");
  });

  it("marks difficult objects without adding another tab stop", () => {
    const { host, outerNote, innerNote, secondOuterNote, secondInnerNote } = buildFixture();

    const cleanup = bindMusicXmlClickTargets({
      hostElement: host,
      difficultObjectIds: ["object-2"],
      onSelectObject: vi.fn(),
      targets: [
        {
          objectId: "object-1",
          label: "第一个音",
          renderedElements: [innerNote],
        },
        {
          objectId: "object-2",
          label: "第二个音，已标记难点",
          renderedElements: [secondInnerNote],
        },
      ],
    });

    expect(outerNote).not.toHaveClass("musicxml-click-target-difficult");
    expect(secondOuterNote).toHaveClass("musicxml-click-target-difficult");
    expect(secondOuterNote).toHaveAttribute("aria-label", "第二个音，已标记难点");
    expect(host.querySelectorAll('[data-musicxml-primary-target][tabindex="0"]')).toHaveLength(1);

    cleanup();
    expect(secondOuterNote).not.toHaveClass("musicxml-click-target-difficult");
  });
});
