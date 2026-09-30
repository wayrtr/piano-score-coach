import PQueue from "p-queue";

type RecognitionQueueTask<T> = {
  jobId: string;
  workId: string;
  task: () => Promise<T>;
};

type RecognitionQueueJobState = {
  workId: string;
  status: "queued" | "running";
  cancelled: boolean;
};

type RecognitionQueueState = {
  queue: PQueue;
  jobs: Map<string, RecognitionQueueJobState>;
};

const globalRecognitionQueue = globalThis as typeof globalThis & {
  __pianoCoachRecognitionQueue?: RecognitionQueueState;
};

function createRecognitionQueueState(): RecognitionQueueState {
  return {
    queue: new PQueue({
      concurrency: 1,
    }),
    jobs: new Map<string, RecognitionQueueJobState>(),
  };
}

export function getRecognitionQueueState() {
  if (!globalRecognitionQueue.__pianoCoachRecognitionQueue) {
    globalRecognitionQueue.__pianoCoachRecognitionQueue =
      createRecognitionQueueState();
  }

  return globalRecognitionQueue.__pianoCoachRecognitionQueue;
}

export function enqueueRecognitionTask<T>(
  input: RecognitionQueueTask<T>,
) {
  const state = getRecognitionQueueState();

  state.jobs.set(input.jobId, {
    workId: input.workId,
    status: "queued",
    cancelled: false,
  });

  return state.queue.add(async () => {
    const jobState = state.jobs.get(input.jobId);

    if (!jobState || jobState.cancelled) {
      state.jobs.delete(input.jobId);
      return undefined;
    }

    state.jobs.set(input.jobId, {
      ...jobState,
      status: "running",
    });

    try {
      return await input.task();
    } finally {
      state.jobs.delete(input.jobId);
    }
  }, { id: input.jobId });
}

export function cancelQueuedRecognitionTasksForWork(workId: string) {
  const state = getRecognitionQueueState();

  for (const [jobId, jobState] of state.jobs.entries()) {
    if (jobState.workId !== workId || jobState.status !== "queued") {
      continue;
    }

    state.jobs.set(jobId, {
      ...jobState,
      cancelled: true,
    });
  }
}

export function getRecognitionQueueSnapshot() {
  const state = getRecognitionQueueState();

  return {
    queued: Array.from(state.jobs.entries())
      .filter(([, jobState]) => jobState.status === "queued" && !jobState.cancelled)
      .map(([jobId, jobState]) => ({
        jobId,
        workId: jobState.workId,
      })),
    running: Array.from(state.jobs.entries())
      .filter(([, jobState]) => jobState.status === "running")
      .map(([jobId, jobState]) => ({
        jobId,
        workId: jobState.workId,
      })),
  };
}
