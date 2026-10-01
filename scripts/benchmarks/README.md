# Opt-in core benchmarks

From the repository root, using the project's Node.js 24 and locked dependencies:

```sh
pnpm exec vitest run --config scripts/benchmarks/vitest.config.ts
```

Run either case separately by appending `scripts/benchmarks/query.ts` or
`scripts/benchmarks/parser.ts`. Normal `pnpm test` does not discover these files.
The configuration runs one worker so the two benchmarks do not compete for CPU.
Avoid running builds or other benchmarks at the same time.

Local Git history must contain baseline commit `87b4eb4`. Each run reads the old
implementation using `git show` into ignored `tmp/benchmarks/`; no duplicate
baseline implementation is maintained in the source tree. Baseline modules use
the current shared dependencies and runtime, so these measurements isolate the
changed query/parser implementation rather than compare complete historical apps.
No real library or user data is read. SQLite fixtures live in temporary folders
and are removed after each run, including when an assertion fails.

## Method and fixtures

- Seven timed samples after one untimed warm-up per operation; median reported
- Full old/new output equality asserted before accepting each result
- Query: 10-work and 1,000-work libraries, four pages per work, 100 objects per
  populated page, every seventeenth work empty, mixed source/status values,
  interleaved page insertion, tied timestamps, and nullable resume positions
- The large query fixture has 4,000 pages and 376,400 score objects; compare list,
  one-work lookup, and missing-work lookup
- Query baseline timings omit the new indexes; index-only timings run the old
  query with the new indexes, distinguishing indexing from query changes
- Parser: 600 generated measures, 4,800 chords, 19,200 notes; compare the complete
  output including annotated XML, IDs, pitches, timing, and page/object order
- MXL: a small score plus an unused, highly compressible 16 MiB attachment;
  compare extracted output, excluding ZIP fixture creation from timings

JSON reports are printed to stdout and saved in ignored
`output/benchmarks/query.json` and `output/benchmarks/parser.json`.
Timing differences are descriptive, with no flaky speed threshold in CI. These
are synthetic local measurements, not UI latency or Audiveris recognition speed.
