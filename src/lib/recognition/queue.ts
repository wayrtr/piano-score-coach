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
  promise: Promise<unknown>;
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
  const existingJob = state.jobs.get(input.jobId);

  // Repeated requests for one score share its active run. Replacing this entry
  // would hide a running job and let its cleanup delete the newer queued job.
  if (existingJob && !existingJob.cancelled) {
    return existingJob.promise as Promise<T | void>;
  }

  const { promise, resolve, reject } = Promise.withResolvers<T | void>();
  const jobState: RecognitionQueueJobState = {
    workId: input.workId,
    status: "queued",
    cancelled: false,
    promise,
  };
  state.jobs.set(input.jobId, jobState);

  const removeJob = () => {
    // A cancelled queued job may have been replaced before it reaches the
    // front of the queue. It must not remove that replacement's state.
    if (state.jobs.get(input.jobId) === jobState) {
      state.jobs.delete(input.jobId);
    }
  };

  void state.queue.add(async () => {
    if (jobState.cancelled) {
      removeJob();
      return undefined;
    }

    jobState.status = "running";

    try {
      return await input.task();
    } finally {
      removeJob();
    }
  }, { id: input.jobId }).then(resolve, reject);

  return promise;
}

export function cancelQueuedRecognitionTasksForWork(workId: string) {
  const state = getRecognitionQueueState();

  for (const jobState of state.jobs.values()) {
    if (jobState.workId !== workId || jobState.status !== "queued") {
      continue;
    }

    jobState.cancelled = true;
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
