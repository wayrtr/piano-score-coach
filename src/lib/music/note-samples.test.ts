import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __clearSampleCache,
  noteNameToSampleMidi,
  playSample,
  preloadSamples,
} from "@/lib/music/note-samples";

describe("noteNameToSampleMidi", () => {
  it("maps in-range notes to their MIDI key", () => {
    expect(noteNameToSampleMidi("A4")).toBe(69);
    expect(noteNameToSampleMidi("C4")).toBe(60);
    expect(noteNameToSampleMidi("A0")).toBe(21);
    expect(noteNameToSampleMidi("C8")).toBe(108);
  });

  it("resolves enharmonic spellings to the same key", () => {
    expect(noteNameToSampleMidi("A#4")).toBe(noteNameToSampleMidi("Bb4"));
  });

  it("returns null outside the sampled range", () => {
    expect(noteNameToSampleMidi("G0")).toBeNull(); // below A0 (21)
    expect(noteNameToSampleMidi("C9")).toBeNull(); // above C8 (108)
  });

  it("returns null for an unparseable note", () => {
    expect(noteNameToSampleMidi("not-a-note")).toBeNull();
  });
});

describe("sample loading + playback", () => {
  const decodedBuffer = { duration: 3 } as unknown as AudioBuffer;

  function createMockContext() {
    const created: Array<{
      buffer: AudioBuffer | null;
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }> = [];
    const context = {
      currentTime: 0,
      destination: {},
      decodeAudioData: vi.fn(async () => decodedBuffer),
      createGain: vi.fn(() => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
        connect: vi.fn(),
      })),
      createBufferSource: vi.fn(() => {
        const node = {
          buffer: null as AudioBuffer | null,
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        };
        created.push(node);
        return node;
      }),
    };

    return { context, created };
  }

  beforeEach(() => {
    __clearSampleCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(8),
      })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __clearSampleCache();
  });

  it("preloads distinct notes once, then plays from cache", async () => {
    const { context, created } = createMockContext();

    await preloadSamples(context as unknown as AudioContext, "piano", [
      "C4",
      "C4", // duplicate → one fetch
      "E4",
    ]);

    // Two distinct in-range notes → two fetch + decode calls.
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2);
    expect(context.decodeAudioData).toHaveBeenCalledTimes(2);

    const node = playSample(context as unknown as AudioContext, {
      instrument: "piano",
      noteName: "C4",
      startTime: 0,
      durationSec: 1,
    });

    expect(node).not.toBeNull();
    expect(created).toHaveLength(1);
    expect(created[0].buffer).toBe(decodedBuffer);
    expect(created[0].start).toHaveBeenCalledOnce();
    expect(created[0].stop).toHaveBeenCalledOnce();
  });

  it("skips off-range notes during preload", async () => {
    const { context } = createMockContext();

    await preloadSamples(context as unknown as AudioContext, "guitar-steel", [
      "C9", // off-range → skipped
      "not-a-note",
    ]);

    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(0);
  });

  it("returns null when the note was never loaded (caller falls back)", () => {
    const { context } = createMockContext();

    const node = playSample(context as unknown as AudioContext, {
      instrument: "piano",
      noteName: "C4",
      startTime: 0,
      durationSec: 1,
    });

    expect(node).toBeNull();
  });

  it("does not throw and skips playback when a sample fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, arrayBuffer: async () => new ArrayBuffer(0) })),
    );
    const { context } = createMockContext();

    await preloadSamples(context as unknown as AudioContext, "piano", ["C4"]);

    const node = playSample(context as unknown as AudioContext, {
      instrument: "piano",
      noteName: "C4",
      startTime: 0,
      durationSec: 1,
    });

    expect(node).toBeNull();
  });
});
