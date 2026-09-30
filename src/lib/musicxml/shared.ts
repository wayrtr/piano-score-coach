export const MUSICXML_OBJECT_ID_ATTRIBUTE = "data-piano-coach-object-id";
const MUSICXML_OBJECT_ID_SCOPE_SEPARATOR = "::";

export function buildMusicXmlObjectId(input: {
  measureNumber: number;
  staffNumber: number;
  voiceNumber: number;
  ordinal: number;
}) {
  return `mxo-m${padNumber(input.measureNumber)}-s${input.staffNumber}-v${input.voiceNumber}-o${padNumber(
    input.ordinal,
  )}`;
}

export function scopeMusicXmlObjectId(scopeId: string, objectId: string) {
  return `${scopeId}${MUSICXML_OBJECT_ID_SCOPE_SEPARATOR}${objectId}`;
}

export function musicXmlStaffNumberToLabel(staffNumber: number) {
  if (staffNumber === 2) {
    return "bass";
  }

  return "treble";
}

function padNumber(value: number) {
  return String(Math.max(0, value)).padStart(4, "0");
}
