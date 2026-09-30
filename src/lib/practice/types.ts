import type {
  Bbox,
  GuitarViewMode,
  InstrumentMode,
  RecognitionStatus,
  ScoreObjectSource,
  ScoreObjectType,
  SourceType,
  WorkStatus,
} from "@/lib/domain/types";

export type PracticeScoreObject = {
  id: string;
  type: ScoreObjectType;
  bbox: Bbox;
  staff: string;
  measure: number;
  /** MusicXML duration units from the start of this measure. */
  onset?: number | null;
  notes: string[];
  confidence: number;
  source: ScoreObjectSource;
};

type PracticePageBase = {
  id: string;
  pageIndex: number;
  recognitionStatus: RecognitionStatus;
  objects: PracticeScoreObject[];
};

export type PracticeImagePage = PracticePageBase & {
  renderMode: "image";
  imageSrc: string;
  imageWidth: number;
  imageHeight: number;
};

export type PracticeMusicXmlPage = PracticePageBase & {
  renderMode: "musicxml";
  musicXmlSrc: string;
  fallbackImageSrc?: string;
  measureStart: number;
  measureEnd: number;
};

export type PracticePage = PracticeImagePage | PracticeMusicXmlPage;

export type PracticeStateSnapshot = {
  lastPageIndex: number;
  lastObjectId: string | null;
  lastMeasure: number | null;
  instrumentMode: InstrumentMode;
  guitarViewMode: GuitarViewMode;
};

export type PracticeWork = {
  id: string;
  title: string;
  sourceType: SourceType;
  status: WorkStatus;
  currentKey: string;
  manualKeyOverride: boolean;
  pageCount: number;
  lastPracticedAt: string | null;
  pages: PracticePage[];
  practiceState: PracticeStateSnapshot | null;
};
