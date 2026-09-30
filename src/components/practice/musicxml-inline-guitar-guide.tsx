import { getGuitarGuidanceForNotes } from "@/lib/music/guitar";
import { assignNoteColors } from "@/lib/music/note-colors";

type MusicXmlInlineGuitarGuideProps = {
  notes: readonly string[];
};

export function MusicXmlInlineGuitarGuide({
  notes,
}: MusicXmlInlineGuitarGuideProps) {
  const guidance = getGuitarGuidanceForNotes(notes);
  const positions = guidance.recommended.positions;
  // Same per-note swatch as the full fretboard, so the inline hint on the score
  // matches the big board and keyboard below it.
  const colors = assignNoteColors(notes);

  if (positions.length === 0) {
    return (
      <div className="musicxml-inline-guitar-guide" aria-label="当前谱行吉他提示">
        <span className="musicxml-inline-guitar-label">吉他 · 推荐把位</span>
        <span className="musicxml-inline-guitar-empty">
          当前音在前 12 品里没有可用位置
        </span>
      </div>
    );
  }

  return (
    <div className="musicxml-inline-guitar-guide" aria-label="当前谱行吉他提示">
      <span className="musicxml-inline-guitar-label">吉他 · 推荐把位</span>
      <div className="musicxml-inline-guitar-strip">
        {positions.map((position) => (
          <span
            key={`${position.stringNumber}-${position.fret}-${position.noteName}`}
            className="musicxml-inline-guitar-pill"
            data-note-color={colors.get(position.midi)}
          >
            {`${position.noteName.replace(/\d+$/, "")} · ${position.stringNumber}弦 ${position.fret}品`}
          </span>
        ))}
      </div>
    </div>
  );
}
