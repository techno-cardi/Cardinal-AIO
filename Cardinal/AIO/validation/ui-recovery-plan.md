# Cardinal C14 UI recovery implementation plan

Goal: restore a readable and recoverable import interface using the exact C14 lineage.

Architecture: preserve the existing native Formative writers, scoring, identities and journal. Prove each observed failure in the full shipped Chrome extension before modifying its cause.

Constraints: keep all 77 archive paths, manifest permissions and version 1.2.0; preserve the resequence and literary-schema fixes; do not invent or alter question content or scores.

Review focus: dark-theme variables missing their matching background, missing content-script receiver after update, a previously hidden packet, close/reload, and real Chrome serialization.

1. Test the exact shipped ZIP using the actual popup, buttons, Chrome worker and storage. Mock only external websites and GraphQL responses. Preserve failing evidence.
2. Change only confirmed causes in the UI and popup. Add local regressions for receiver recovery and masking. Run the full existing test suite.
3. Re-extract the final ZIP, verify its CRC and byte differences, then repeat the browser flow. Keep the original C14 ZIP available for rollback.

Decision: use a branch-only GitHub test job because this workspace prevents Chromium from creating its required Unix socket. It has read-only repository permissions and never connects to the user's Formative account.
