import type {
  InstrumentMode,
  RecognitionStatus,
  ScoreObjectSource,
  ScoreObjectType,
  WorkStatus,
} from "@/lib/domain/types";

/** Keep internal state values out of the practice UI. */
export function getWorkStatusLabel(status: string | WorkStatus) {
  const labels: Record<string, string> = {
    draft: "待开始",
    processing: "正在整理",
    ready: "可以开始",
    failed: "需要处理",
  };

  return labels[status] ?? "需要处理";
}

export function getRecognitionStatusLabel(status: string | RecognitionStatus) {
  const labels: Record<string, string> = {
    queued: "排队中",
    normalizing: "准备页面",
    recognizing: "正在识别",
    succeeded: "已准备好",
    failed: "识别失败",
  };

  return labels[status] ?? "状态待确认";
}

export function getObjectSourceLabel(source: string | ScoreObjectSource) {
  const labels: Record<string, string> = {
    model: "自动识别",
    user: "你已修正",
    rerun: "重新识别",
  };

  return labels[source] ?? "来源待确认";
}

export function getObjectTypeLabel(type: string | ScoreObjectType) {
  const labels: Record<string, string> = {
    note: "单音",
    chord: "和弦",
    other: "其他记号",
  };

  return labels[type] ?? "其他对象";
}

export function getStaffLabel(staff: string) {
  const normalized = staff.trim().toLowerCase();
  const labels: Record<string, string> = {
    treble: "高音谱表",
    upper: "高音谱表",
    right: "右手谱表",
    bass: "低音谱表",
    lower: "低音谱表",
    left: "左手谱表",
    grand: "大谱表",
    alto: "中音谱表",
  };

  return labels[normalized] ?? "谱表待确认";
}

export function getInstrumentLabel(mode: string | InstrumentMode) {
  return mode === "guitar" ? "吉他" : mode === "piano" ? "钢琴" : "参考乐器";
}

export function formatPracticeDate(value: string | null | undefined) {
  if (!value) {
    return "还没有练习记录";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "还没有练习记录";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
