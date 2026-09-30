import { extractMusicXmlSource, parseMusicXmlDocument } from "@/lib/musicxml/parser";

export function createMusicXmlImportArtifacts(input: {
  buffer: Buffer;
  fileName: string;
}) {
  const extracted = extractMusicXmlSource(input);
  const parsed = parseMusicXmlDocument(extracted.xmlText);

  return {
    extracted,
    parsed,
  };
}
