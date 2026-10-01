# Core optimization and regression evidence

## Scope

Starting revision: `87b4eb4d1b11e8726ca9c4c857e0f5b13dae269e`.
Runtime: Node.js 24.19.0, pnpm 10.30.3, the unchanged dependency lockfile.

The existing Next.js/local SQLite/Audiveris architecture is retained. No frontend
components, route handlers, styles, artwork, fonts, or interaction code changed.
The internal changes are:

- Indexed work/page existence queries rather than reading every score object;
  direct lookup of one work and one-pass grouping of its pages
- Additive, idempotent page indexes for score objects and recognition results;
  existing data is preserved, with a one-time index build on first startup
- Selective MXL extraction with pre-allocation limits and metadata exclusion;
  malformed XML, unsupported pitch alterations and unsafe timing fail explicitly
  instead of silently generating an incorrect key or onset
- Reused note collator and allocation-free first-child lookups during parsing
- Safe-integer validation in shared written-note/MIDI conversion
- PNG dimensions read from a 24-byte header; missing/truncated caches no longer
  prevent loading the rest of a work
- Coalesced duplicate recognition jobs; identity-safe cleanup after cancellation
- PDF worker/page cleanup on failed loading, rendering, and PNG encoding
- Isolated POSIX Audiveris process groups, timeout escalation, bounded pipe
  teardown, and timer/output-listener cleanup

MusicXML is limited to 32 MiB of XML, with a 1 MiB MXL container manifest. The
current instrument model supports integer timing values and semitone alterations
from -2 to +2. Fractional/unsupported pitches and unsafe numeric values are
rejected rather than rounded to another piano key. Unused MXL attachments are
not inflated. These limits do not change the UI or the successful output for the
supported scores covered by the regression tests.

## Reproducing measurements

See [`scripts/benchmarks/README.md`](../../scripts/benchmarks/README.md). The
benchmarks retrieve baseline code from Git, create deterministic synthetic data,
assert deep equality of old/new successful results, and report seven warm-run
medians. They do not measure browser rendering or real Audiveris recognition.
Generated files, databases, and JSON reports stay in ignored temporary/output
folders. No real user scores or account data are used.

## Verification boundary

The baseline full suite passed 380 tests in 55 files. Final validation passed:

- 435 tests across 58 files (55 added regression cases)
- Full ESLint, TypeScript `--noEmit`, production `next build`, and `git diff --check`
- Production HTTP smoke: homepage/work server rendering, MusicXML and MXL
  import, exact written pitches, annotated source retrieval, saved guitar
  selection, failed-import cleanup, deletion, and missing-work response
- `git diff --exit-code -- src/app src/components public`: no visual or
  interaction-source changes
- A separate review caught and regression-tested forged ZIP size metadata in
  uncompressed entries before final validation

Measured on the same Linux x64 runtime, seven timed runs after one warm-up:

| Synthetic case | Baseline median | Optimized median |
| --- | ---: | ---: |
| List 1,000 works / 4,000 pages / 376,400 objects | 395.072 ms | 9.525 ms |
| Look up one work in that library | 397.189 ms | 0.354 ms |
| Look up a missing work | 392.312 ms | 0.165 ms |
| Parse 19,200 notes / 4,800 chords | 699.826 ms | 503.455 ms |
| Extract small MXL score with unused 16 MiB attachment | 50.808 ms | 0.041 ms |

The list case is about 41.5 times faster; parser time falls by 28.1%. MXL timing
isolates extraction and uses a highly compressible synthetic attachment; the
important resource improvement is avoiding its inflation/allocation. These
numbers are machine- and fixture-specific, not general end-to-end promises.
Output equality is checked before benchmark results are accepted.

The real subprocess regression terminates an inherited-pipe descendant in about
1.01 seconds for a 1-second configured limit. Forced timeout settlement is bounded
by the configured limit plus a 5-second shutdown grace when a process ignores
termination.

The cloud browser could not reach the command environment's loopback preview;
no screenshot/pixel-diff claim is made. Visual-source identity and the existing
component/keyboard/selection/import tests are the UI regression evidence.

The real Audiveris application was not installed in this Linux test environment.
Tests cover its adapter with controlled executables, including a real wrapper
that spawns a descendant inheriting output pipes. Windows process signaling is
unit-tested through a platform mock: child-only termination and bounded pipe
teardown are covered, but terminating an entire Windows process tree is not
claimed.

Two pre-existing issues are outside this patch: deleting a work does not abort
an already-running recognizer, and partial Web Audio oscillator setup failures
can retain an already-scheduled sound. Neither the deletion workflow nor audio
implementation was changed in this scoped optimization.
