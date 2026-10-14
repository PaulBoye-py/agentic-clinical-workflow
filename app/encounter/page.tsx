"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { EncounterStatus, EncounterView, ReviewedSection } from "@/lib/types";
import { useAuth } from "../auth-provider";
import { NewConsultation } from "./new-consultation";
import { ReviewPanel } from "./review-panel";
import { useEncounter } from "./use-encounter";

export default function EncounterPage() {
  return (
    <Suspense fallback={<p className="text-slate-500">Loading…</p>}>
      <EncounterScreen />
    </Suspense>
  );
}

const STATUS_LABEL: Record<EncounterStatus, string> = {
  CREATED: "Awaiting audio",
  AUDIO_UPLOADED: "Audio uploaded",
  TRANSCRIBING: "Transcribing",
  NOTE_READY: "Draft note ready",
  NOTE_REVIEWED: "Note approved",
  AGENT_RUNNING: "Assistant running",
  NEEDS_INPUT: "Needs your input",
  AWAITING_APPROVAL: "Awaiting your approval",
  COMPLETED: "Completed",
  REJECTED: "Rejected",
  FAILED: "Failed",
};

function EncounterScreen() {
  const params = useSearchParams();
  const router = useRouter();
  const { state } = useAuth();
  const encounterId = params.get("id");
  const patientId = params.get("patient");

  useEffect(() => {
    if (state.status === "signedOut") router.replace("/login/");
  }, [state.status, router]);

  if (state.status !== "signedIn") return <p className="text-slate-500">Loading…</p>;

  if (!encounterId) {
    if (!patientId) return <p className="text-red-700">No patient selected.</p>;
    return (
      <div className="space-y-6">
        <Heading patientId={patientId} />
        <WorkflowBadge />
        <NewConsultation patientId={patientId} onUploaded={(id) => router.replace(`/encounter/?id=${id}&uploaded=1`)} />
      </div>
    );
  }

  return <ExistingEncounter encounterId={encounterId} justUploaded={params.get("uploaded") === "1"} />;
}

function ExistingEncounter({ encounterId, justUploaded }: { encounterId: string; justUploaded: boolean }) {
  const { data, error, setData } = useEncounter(encounterId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  async function run(fn: () => Promise<Partial<EncounterView>>) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await fn();
      if (res.encounter && data) setData({ ...data, ...res, encounter: res.encounter });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  if (error && !data) {
    return (
      <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
        Could not load encounter: {error}
      </p>
    );
  }
  if (!data) return <p className="text-slate-500">Loading encounter…</p>;

  const enc = data.encounter;
  const startTranscription = () =>
    run(() => apiFetch<Partial<EncounterView>>(`/encounters/${enc.encounterId}/transcribe`, { method: "POST" }));
  const approveNote = (sections: ReviewedSection[]) =>
    run(() => apiFetch<Partial<EncounterView>>(`/encounters/${enc.encounterId}/note`, { method: "PUT", body: { reviewedNote: { sections } } }));

  return (
    <div className="space-y-6">
      <Heading patientId={enc.patientId} encounterId={enc.encounterId} status={enc.status} />

      {enc.status === "FAILED" && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-5 py-4 text-red-900">
          <p className="font-semibold">This encounter failed</p>
          <p className="mt-1">{enc.error?.message ?? "Unknown error."}</p>
          <p className="mt-1 font-mono text-sm text-red-700">{enc.error?.code}</p>
        </div>
      )}
      {actionError && (
        <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          {actionError}
        </p>
      )}
      {error && <p className="text-amber-700">Connection problem, retrying: {error}</p>}

      <WorkflowBadge />

      {enc.status === "CREATED" && (
        <div className="rounded-xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">2. Transcribe with AWS HealthScribe</h2>
          <p className="mt-1 text-slate-600">
            {justUploaded ? "Audio uploaded to S3." : "Make sure the audio has been uploaded."} HealthScribe produces a
            transcript and a draft clinical note.
          </p>
          <button
            onClick={() => void startTranscription()}
            disabled={busy}
            className="mt-4 rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
          >
            {busy ? "Starting…" : "Start transcription"}
          </button>
        </div>
      )}

      {enc.status === "TRANSCRIBING" && <Transcribing startedAt={enc.transcribeStartedAt} />}

      {enc.transcript && enc.draftNote && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h2 className="text-lg font-semibold text-slate-900">3. Review the draft note</h2>
            {enc.scribe?.jobDurationMs && (
              <span className="text-sm text-slate-500">
                HealthScribe job {Math.round(enc.scribe.jobDurationMs / 1000)} s · template {enc.scribe.template}
              </span>
            )}
          </div>
          <ReviewPanel
            transcript={enc.transcript}
            draftNote={enc.draftNote}
            reviewed={enc.reviewedNote?.sections}
            readOnly={enc.status !== "NOTE_READY"}
            busy={busy}
            onApprove={(sections) => void approveNote(sections)}
          />
        </div>
      )}

      {enc.status === "NOTE_REVIEWED" && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-teal-900">
          Note approved by you. The assistant step (Amazon Bedrock) is added in the next build phase.
        </div>
      )}
    </div>
  );
}

function Transcribing({ startedAt }: { startedAt?: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const elapsed = startedAt ? Math.max(0, Math.round((now - new Date(startedAt).getTime()) / 1000)) : null;
  return (
    <div className="flex items-center gap-4 rounded-xl border border-slate-200 bg-white p-6">
      <span className="h-3 w-3 animate-pulse rounded-full bg-teal-600" />
      <div>
        <p className="font-semibold text-slate-900">AWS HealthScribe is transcribing</p>
        <p className="text-slate-600">
          Usually about 75 seconds for a 2-minute consultation.{elapsed !== null && ` Elapsed: ${elapsed} s.`}
        </p>
      </div>
    </div>
  );
}

function Heading({ patientId, encounterId, status }: { patientId: string; encounterId?: string; status?: EncounterStatus }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Consultation</h1>
        <p className="mt-1 text-slate-600">
          Patient <span className="font-mono">{patientId}</span>
          {encounterId && (
            <>
              <span className="mx-2 text-slate-300">·</span>
              <span className="font-mono text-sm">{encounterId}</span>
            </>
          )}
        </p>
      </div>
      {status && (
        <span
          className={`rounded-full px-3 py-1 font-medium ${
            status === "FAILED" ? "bg-red-100 text-red-900" : status === "COMPLETED" ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-800"
          }`}
        >
          {STATUS_LABEL[status]}
        </span>
      )}
    </div>
  );
}

function WorkflowBadge() {
  return (
    <span className="inline-block rounded-md border border-slate-300 bg-white px-3 py-1 text-sm font-medium text-slate-700">
      Workflow (deterministic + HealthScribe)
    </span>
  );
}
