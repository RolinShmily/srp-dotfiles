import {
  isObservationsDroppedData,
  isObservationsRecordedData,
  OM_OBSERVATIONS_DROPPED,
  OM_OBSERVATIONS_RECORDED,
  type Entry,
  type Observation,
} from "./types.ts";

export type FoldLedgerOptions = {
  /** Fold entries from branch root through this entry id, inclusive. Omit to fold through branch tip. */
  upToEntryId?: string;
};

export type FoldedLedger = {
  /** Every first-valid observation record through the fold boundary, including dropped ones. */
  observations: Observation[];
  /** Observations not tombstoned by a folded drop entry — the live injected buffer. */
  activeObservations: Observation[];
  /** Tombstoned observation timestamps, including ids with no corresponding folded observation. */
  droppedObservationTimestamps: Set<string>;
  /** First-valid observation records by timestamp (id), including dropped ones. */
  observationsByTimestamp: Map<string, Observation>;
};

function foldEndIndex(entries: Entry[], upToEntryId: string | undefined): number {
  if (!upToEntryId) return entries.length - 1;
  const idx = entries.findIndex((entry) => entry.id === upToEntryId);
  return idx === -1 ? entries.length - 1 : idx;
}

function isCustomEntry(entry: Entry, customType: string): boolean {
  return entry.type === "custom" && entry.customType === customType;
}

/**
 * Fold valid memory ledger entries from the branch root through the target entry.
 */
export function foldLedger(entries: Entry[], options: FoldLedgerOptions = {}): FoldedLedger {
  const observationsByTimestamp = new Map<string, Observation>();
  const droppedObservationTimestamps = new Set<string>();
  const endIdx = foldEndIndex(entries, options.upToEntryId);

  for (let i = 0; i <= endIdx; i++) {
    const entry = entries[i];
    if (!entry) continue;

    if (isCustomEntry(entry, OM_OBSERVATIONS_RECORDED)) {
      if (!isObservationsRecordedData(entry.data)) continue;
      for (const observation of entry.data.observations) {
        if (!observationsByTimestamp.has(observation.timestamp)) {
          observationsByTimestamp.set(observation.timestamp, observation);
        }
      }
      continue;
    }

    if (isCustomEntry(entry, OM_OBSERVATIONS_DROPPED)) {
      if (!isObservationsDroppedData(entry.data)) continue;
      for (const timestamp of entry.data.observationTimestamps) {
        droppedObservationTimestamps.add(timestamp);
      }
    }
  }

  const observations = Array.from(observationsByTimestamp.values());
  const activeObservations = observations.filter(
    (observation) => !droppedObservationTimestamps.has(observation.timestamp),
  );

  return {
    observations,
    activeObservations,
    droppedObservationTimestamps,
    observationsByTimestamp,
  };
}
