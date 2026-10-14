"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { EncounterStatus, EncounterView } from "@/lib/types";

// Statuses where the server is doing work and the UI should poll.
const ACTIVE: EncounterStatus[] = ["TRANSCRIBING", "AGENT_RUNNING"];
const POLL_MS = 1000;

export function useEncounter(encounterId: string | null) {
  const [data, setData] = useState<EncounterView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  useEffect(() => {
    if (!encounterId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = () => {
      apiFetch<EncounterView>(`/encounters/${encounterId}`).then(
        (view) => {
          if (cancelled) return;
          setData(view);
          setError(null);
          if (ACTIVE.includes(view.encounter.status)) timer = setTimeout(load, POLL_MS);
        },
        (err: Error) => {
          if (cancelled) return;
          setError(err.message);
          // Keep polling through transient network errors while work is in progress.
          timer = setTimeout(load, POLL_MS * 3);
        },
      );
    };
    load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [encounterId, version]);

  return { data, error, refresh, setData };
}
