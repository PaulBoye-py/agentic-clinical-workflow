"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Action, AuditEvent, Encounter, EncounterStep } from "@/lib/types";

interface Props {
  encounter: Encounter;
  steps: EncounterStep[];
  actions: Action[];
  busy: boolean;
  onReply: (answer: string) => void;
  onDecide: (actionId: string, decision: "approve" | "reject", reason?: string) => void;
}

export function AgentPanel({ encounter, steps, actions, busy, onReply, onDecide }: Props) {
  const [tab, setTab] = useState<"timeline" | "audit">("timeline");
  const running = encounter.status === "AGENT_RUNNING";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-block rounded-md border border-violet-300 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-900">
          Agent (Amazon Bedrock)
        </span>
        <h2 className="text-lg font-semibold text-slate-900">4. Assistant</h2>
        {running && (
          <span className="flex items-center gap-2 text-slate-600">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-violet-600" /> working…
          </span>
        )}
      </div>

      {encounter.status === "NEEDS_INPUT" && encounter.pendingQuestion && (
        <QuestionPanel question={encounter.pendingQuestion} busy={busy} onReply={onReply} />
      )}

      {actions.map((a) => (
        <ActionCard key={a.actionId} action={a} canDecide={encounter.status === "AWAITING_APPROVAL"} busy={busy} onDecide={onDecide} />
      ))}

      {encounter.agentSummary && (
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-slate-900">Assistant summary</h3>
            <DraftBadge />
          </div>
          <p className="mt-2 whitespace-pre-line text-slate-800">{plain(encounter.agentSummary)}</p>
        </div>
      )}

      <div className="rounded-xl border border-slate-200 bg-white">
        <div className="flex border-b border-slate-200">
          {(["timeline", "audit"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-5 py-3 font-medium ${tab === t ? "border-b-2 border-teal-700 text-teal-800" : "text-slate-500 hover:text-slate-800"}`}
            >
              {t === "timeline" ? "Timeline" : "Audit"}
            </button>
          ))}
        </div>
        {tab === "timeline" ? <Timeline steps={steps} /> : <AuditLog encounterId={encounter.encounterId} refreshKey={`${encounter.status}-${steps.length}`} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

const ACTOR_STYLE: Record<EncounterStep["actor"], string> = {
  model: "bg-violet-100 text-violet-900",
  application: "bg-slate-200 text-slate-800",
  clinician: "bg-teal-100 text-teal-900",
};

const TYPE_LABEL: Record<string, string> = {
  MODEL_TURN: "Model",
  TOOL_REQUEST: "Tool request",
  TOOL_RESULT: "Tool result",
  TOOL_DENIED: "Denied",
  DETERMINISTIC_CHECK: "Deterministic check, not AI",
  QUESTION: "Question",
  ANSWER: "Answer",
  ACTION_PROPOSED: "Action proposed",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  ERROR: "Error",
};

function Timeline({ steps }: { steps: EncounterStep[] }) {
  if (steps.length === 0) return <p className="p-5 text-slate-500">No steps yet.</p>;
  return (
    <ol className="divide-y divide-slate-100">
      {steps.map((s) => {
        const denied = s.type === "TOOL_DENIED" || s.type === "ERROR";
        const deterministic = s.type === "DETERMINISTIC_CHECK";
        return (
          <li
            key={s.seq}
            className={`flex gap-4 px-5 py-3 ${denied ? "bg-red-50" : deterministic ? "border-l-4 border-l-sky-500 bg-sky-50" : ""}`}
          >
            <span className="w-8 shrink-0 pt-0.5 font-mono text-sm text-slate-400">{Number(s.seq)}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded px-2 py-0.5 font-medium ${ACTOR_STYLE[s.actor]}`}>{s.actor}</span>
                <span className={`font-semibold ${denied ? "text-red-800" : deterministic ? "text-sky-900" : "text-slate-800"}`}>
                  {TYPE_LABEL[s.type] ?? s.type}
                </span>
                {s.toolName && <span className="font-mono text-slate-600">{s.toolName}</span>}
                {s.latencyMs !== undefined && <span className="text-slate-400">{s.latencyMs} ms</span>}
                {s.model && <span className="font-mono text-xs text-slate-400">{s.model}</span>}
              </div>
              <p className={`mt-1 whitespace-pre-line ${denied ? "text-red-900" : "text-slate-800"}`}>{s.summary}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function AuditLog({ encounterId, refreshKey }: { encounterId: string; refreshKey: string }) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ audit: AuditEvent[] }>(`/encounters/${encounterId}/audit`).then(
      (r) => !cancelled && setEvents(r.audit),
      (err: Error) => !cancelled && setError(err.message),
    );
    return () => {
      cancelled = true;
    };
  }, [encounterId, refreshKey]);

  if (error) return <p className="p-5 text-red-800">Could not load audit: {error}</p>;
  if (!events) return <p className="p-5 text-slate-500">Loading audit…</p>;
  if (events.length === 0) return <p className="p-5 text-slate-500">No audit events yet.</p>;
  return (
    <table className="w-full text-left">
      <thead className="text-sm text-slate-500">
        <tr>
          <th className="px-5 py-2 font-medium">Time</th>
          <th className="px-2 py-2 font-medium">Event</th>
          <th className="px-2 py-2 font-medium">Actor</th>
          <th className="px-2 py-2 font-medium">Details</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {events.map((e) => (
          <tr key={e.sk} className={/DENIED|FAILURE/.test(e.event) ? "bg-red-50" : ""}>
            <td className="px-5 py-2 font-mono text-sm text-slate-500">{e.ts.slice(11, 19)}</td>
            <td className={`px-2 py-2 font-medium ${/DENIED|FAILURE/.test(e.event) ? "text-red-800" : "text-slate-800"}`}>{e.event}</td>
            <td className="px-2 py-2 text-slate-700">{e.actor}</td>
            <td className="px-2 py-2 font-mono text-sm text-slate-600">
              {[e.doctorId, e.patientId, e.toolName, e.actionId, e.reason].filter(Boolean).join(" · ")}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------

function QuestionPanel({ question, busy, onReply }: { question: { question: string; missingItems: string[] }; busy: boolean; onReply: (a: string) => void }) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-5">
      <p className="text-sm font-semibold uppercase tracking-wide text-amber-800">The assistant needs your input</p>
      <p className="mt-2 text-lg text-slate-900">{question.question}</p>
      {question.missingItems.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {question.missingItems.map((m) => (
            <span key={m} className="rounded-full bg-white px-3 py-1 text-sm text-amber-900 ring-1 ring-amber-300">
              {m}
            </span>
          ))}
        </div>
      )}
      <form
        className="mt-4 flex gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (answer.trim()) onReply(answer.trim());
        }}
      >
        <input
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder="Your answer"
          className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-2 text-slate-900 focus:border-teal-600 focus:outline-none"
        />
        <button type="submit" disabled={busy || !answer.trim()} className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50">
          Send
        </button>
      </form>
    </div>
  );
}

function DraftBadge() {
  return <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-bold tracking-wide text-amber-900">DRAFT</span>;
}

// The model sometimes adds Markdown emphasis despite being asked not to.
const plain = (text: string) => text.replace(/\*\*(.+?)\*\*/g, "$1").replace(/^#+\s*/gm, "").trim();

const label = (v: unknown) => String(v).replace(/_/g, " ").toLowerCase();

function ActionCard({ action, canDecide, busy, onDecide }: { action: Action; canDecide: boolean; busy: boolean; onDecide: Props["onDecide"] }) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const p = action.payload as Record<string, unknown>;
  const pending = action.status === "PENDING_APPROVAL";

  const rows: [string, React.ReactNode][] =
    action.type === "REFERRAL"
      ? [
          ["Specialty", label(p.specialty)],
          ["Urgency", label(p.urgency)],
          ["Reason", String(p.reason ?? "")],
          ["Relevant findings", <List key="f" items={p.relevantFindings} />],
          ["Allergies", <List key="a" items={p.allergies} emphasise />],
          ["Imaging", String(p.imagingReference ?? "None")],
        ]
      : [
          ["Interval", `${String(p.intervalMonths)} months`],
          ["Reason", String(p.reason ?? "")],
        ];

  return (
    <div className={`rounded-xl border-2 bg-white p-5 ${pending ? "border-amber-300" : action.status === "APPROVED" ? "border-teal-400" : "border-slate-300"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-lg font-semibold text-slate-900">Proposed {action.type === "REFERRAL" ? "referral" : "recall"}</h3>
          {pending && <DraftBadge />}
        </div>
        <span
          className={`rounded-full px-3 py-1 text-sm font-medium ${
            pending ? "bg-amber-100 text-amber-900" : action.status === "APPROVED" ? "bg-teal-100 text-teal-900" : "bg-slate-200 text-slate-800"
          }`}
        >
          {action.status === "PENDING_APPROVAL" ? "Awaiting your approval" : `${action.status === "APPROVED" ? "Approved" : "Rejected"} by ${action.decidedBy}`}
        </span>
      </div>

      <dl className="mt-4 grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-slate-500">{k}</dt>
            <dd className="text-slate-900">{v}</dd>
          </div>
        ))}
      </dl>

      {pending && canDecide && (
        <div className="mt-5 border-t border-slate-200 pt-4">
          {rejecting ? (
            <div className="flex flex-wrap gap-3">
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Reason (optional)"
                className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-slate-900"
              />
              <button onClick={() => onDecide(action.actionId, "reject", reason.trim() || undefined)} disabled={busy} className="rounded-md bg-slate-700 px-4 py-2 font-medium text-white disabled:opacity-50">
                Confirm reject
              </button>
              <button onClick={() => setRejecting(false)} className="px-3 py-2 text-slate-600">
                Cancel
              </button>
            </div>
          ) : (
            <div className="flex gap-3">
              <button onClick={() => onDecide(action.actionId, "approve")} disabled={busy} className="rounded-md bg-teal-700 px-5 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50">
                Approve
              </button>
              <button onClick={() => setRejecting(true)} disabled={busy} className="rounded-md border border-slate-300 px-5 py-2 font-medium text-slate-800 hover:bg-slate-50">
                Reject
              </button>
            </div>
          )}
          <p className="mt-3 text-sm text-slate-500">Only you can approve. The assistant has no permission to change this action.</p>
        </div>
      )}
    </div>
  );
}

function List({ items, emphasise }: { items: unknown; emphasise?: boolean }) {
  const list = Array.isArray(items) ? (items as string[]) : [];
  if (list.length === 0) return <span className="text-slate-400">None</span>;
  return (
    <ul className={`list-disc pl-5 ${emphasise ? "font-semibold text-red-800" : ""}`}>
      {list.map((x) => (
        <li key={x}>{x}</li>
      ))}
    </ul>
  );
}
