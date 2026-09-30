import {
  buildMusicXmlSystemAnchors,
  findMusicXmlSystemAnchor,
} from "@/components/practice/musicxml-system-anchor";

describe("musicxml system anchors", () => {
  it("merges overlapping staffline rectangles into one system", () => {
    const systems = buildMusicXmlSystemAnchors([
      { top: 51, bottom: 165, left: 137, right: 693 },
      { top: 105, bottom: 241, left: 137, right: 693 },
      { top: 289, bottom: 375, left: 50, right: 693 },
      { top: 315, bottom: 459, left: 50, right: 693 },
    ]);

    expect(systems).toEqual([
      { top: 51, bottom: 241, left: 137, right: 693 },
      { top: 289, bottom: 459, left: 50, right: 693 },
    ]);
  });

  it("finds the nearest system for a rendered target rectangle", () => {
    const systems = [
      { top: 51, bottom: 241, left: 137, right: 693 },
      { top: 289, bottom: 459, left: 50, right: 693 },
    ];

    const anchor = findMusicXmlSystemAnchor(systems, {
      top: 320,
      bottom: 348,
      left: 260,
      right: 286,
    });

    expect(anchor).toEqual({ top: 289, bottom: 459, left: 50, right: 693 });
  });
});
