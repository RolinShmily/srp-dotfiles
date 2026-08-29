import type { Config } from "../config.ts";
import {
  entryIndexById,
  foldLedger,
  isObservationsRecordedEntry,
  rawTokensAfterIndex,
  rawTokensSinceObservationCoverage,
  type Entry,
} from "../ledger/index.ts";

/** Glyphs for the timeline strip. */
const GLYPH = {
  consolidated: "▓", // observations promoted to .memory (long-term)
  partial: "▚",      // chunk straddling the pool-target boundary (some obs promoted)
  pool: "▒",         // observed, still in the short-term buffer
  raw: "░",          // raw history not yet distilled into observations
  cut: "┊",          // compaction cutoff (verbatim tail began here)
  tip: "▶",          // live branch tip
} as const;

/** A committed observation chunk, in branch order. */
type Chunk = { coversUpToIndex: number; timestamps: string[] };

function fmtK(tokens: number): string {
  if (tokens < 1000) return `${tokens}`;
  return `${(tokens / 1000).toFixed(1)}k`;
}

function collectChunks(branch: Entry[]): Chunk[] {
  const indexById = entryIndexById(branch);
  const chunks: Chunk[] = [];
  for (const entry of branch) {
    if (!isObservationsRecordedEntry(entry)) continue;
    const coversUpToIndex = indexById.get(entry.data.coversUpToId);
    if (coversUpToIndex === undefined) continue;
    chunks.push({ coversUpToIndex, timestamps: entry.data.observations.map((o) => o.timestamp) });
  }
  return chunks;
}

/** Branch indices of every compaction entry's `firstKeptEntryId` (the verbatim-tail cutoffs). */
function compactionCutIndices(branch: Entry[]): number[] {
  const indexById = entryIndexById(branch);
  const cuts: number[] = [];
  for (const entry of branch) {
    if (entry.type !== "compaction") continue;
    const idx = entry.firstKeptEntryId ? indexById.get(entry.firstKeptEntryId) : undefined;
    if (idx !== undefined) cuts.push(idx);
  }
  return cuts;
}

function chunkGlyph(chunk: Chunk, dropped: Set<string>): string {
  let droppedCount = 0;
  for (const ts of chunk.timestamps) if (dropped.has(ts)) droppedCount++;
  if (droppedCount === 0) return GLYPH.pool;
  if (droppedCount === chunk.timestamps.length) return GLYPH.consolidated;
  return GLYPH.partial;
}

function wrap(cells: string[], width: number): string {
  if (cells.length === 0) return "";
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += width) rows.push(cells.slice(i, i + width).join(""));
  return rows.join("\n");
}

/**
 * Render the full session as a horizontal strip.
 */
export function renderTimeline(branch: Entry[], config: Config, width = 60): string {
  const folded = foldLedger(branch);
  const dropped = folded.droppedObservationTimestamps;
  const chunks = collectChunks(branch);

  const cells: string[] = chunks.map((chunk) => chunkGlyph(chunk, dropped));
  const tailTokens = rawTokensSinceObservationCoverage(branch);
  const tailCells = tailTokens > 0 ? Math.ceil(tailTokens / config.chunkTokens) : 0;
  for (let i = 0; i < tailCells; i++) cells.push(GLYPH.raw);

  const cutPositions = compactionCutIndices(branch)
    .map((cutIdx) => {
      let pos = 0;
      for (const chunk of chunks) if (chunk.coversUpToIndex < cutIdx) pos++;
      return Math.min(pos, cells.length);
    })
    .sort((a, b) => b - a);
  for (const pos of cutPositions) cells.splice(pos, 0, GLYPH.cut);

  const consolidatedChunks = chunks.filter((c) => chunkGlyph(c, dropped) === GLYPH.consolidated).length;
  const poolChunks = chunks.filter((c) => chunkGlyph(c, dropped) === GLYPH.pool).length;
  const rawTotal = rawTokensAfterIndex(branch, -1);
  const compactions = cutPositions.length;

  const strip = cells.length > 0 ? `${wrap(cells, width)}${GLYPH.tip}` : "(timeline empty)";

  return [
    `srp-memory timeline · 1 格 ≈ ${fmtK(config.chunkTokens)} tok · 累计 ${fmtK(rawTotal)} raw · ${compactions} 次压缩`,
    strip,
    ``,
    `  ${GLYPH.consolidated} .memory (${consolidatedChunks})   ${GLYPH.pool} pool (${poolChunks})   ${GLYPH.raw} raw   ${GLYPH.cut} compaction cut   ${GLYPH.tip} tip`,
  ].join("\n");
}
