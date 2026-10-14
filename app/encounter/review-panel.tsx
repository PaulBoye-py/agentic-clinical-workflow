"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { sectionLabel, type NoteSection, type ReviewedSection, type TranscriptSegment } from "@/lib/types";

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

interface Props {
  transcript: TranscriptSegment[];
  draftNote: NoteSection[];
  reviewed?: ReviewedSection[];
  readOnly: boolean;
  busy: boolean;
  onApprove: (sections: ReviewedSection[]) => void;
}

export function ReviewPanel({ transcript, draftNote, reviewed, readOnly, busy, onApprove }: Props) {
  // Section text the clinician has edited; unedited sections use the draft.
  const [edits, setEdits] = useState<Record<string, string>>(() =>
    Object.fromEntries((reviewed ?? []).map((s) => [s.name, s.text])),
  );
  const [editing, setEditing] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ section: string; index: number } | null>(null);

  const evidence = useMemo(() => {
    if (!selected) return new Set<string>();
    const sentence = draftNote.find((s) => s.name === selected.section)?.sentences[selected.index];
    return new Set(sentence?.evidence ?? []);
  }, [selected, draftNote]);

  const transcriptRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const first = transcript.find((s) => evidence.has(s.segmentId));
    if (first) {
      transcriptRef.current
        ?.querySelector(`[data-segment="${first.segmentId}"]`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [evidence, transcript]);

  const draftText = (s: NoteSection) => s.sentences.map((x) => x.text).join("\n");
  const finalSections = (): ReviewedSection[] =>
    draftNote.map((s) => ({ name: s.name, text: (edits[s.name] ?? draftText(s)).trim() }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Transcript */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <h3 className="border-b border-slate-200 px-5 py-3 font-semibold text-slate-900">Transcript</h3>
        <div ref={transcriptRef} className="max-h-[60vh] space-y-1 overflow-y-auto p-3">
          {transcript.map((seg) => (
            <div
              key={seg.segmentId}
              data-segment={seg.segmentId}
              className={`rounded-md px-3 py-2 transition-colors ${evidence.has(seg.segmentId) ? "bg-amber-100 ring-1 ring-amber-300" : ""}`}
            >
              <div className="flex items-baseline gap-2 text-sm">
                <span className={`font-semibold ${seg.role === "CLINICIAN" ? "text-teal-800" : "text-indigo-800"}`}>
                  {seg.role === "CLINICIAN" ? "Clinician" : seg.role === "PATIENT" ? "Patient" : "Speaker"}
                </span>
                <span className="font-mono text-slate-400">{mmss(seg.startSec)}</span>
              </div>
              <p className="text-slate-800">{seg.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Draft note */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
          <h3 className="font-semibold text-slate-900">{readOnly ? "Clinician-approved note" : "Draft note (AWS HealthScribe)"}</h3>
          {!readOnly && <span className="text-sm text-slate-500">Click a line to see its evidence</span>}
        </div>
        <div className="max-h-[60vh] space-y-5 overflow-y-auto p-5">
          {draftNote.map((section) => {
            const edited = edits[section.name];
            const isEditing = editing === section.name;
            return (
              <div key={section.name}>
                <div className="flex items-center justify-between">
                  <h4 className="font-semibold text-slate-800">{sectionLabel(section.name)}</h4>
                  {!readOnly && (
                    <button
                      onClick={() => setEditing(isEditing ? null : section.name)}
                      className="text-sm text-teal-700 hover:underline"
                    >
                      {isEditing ? "Done" : "Edit"}
                    </button>
                  )}
                </div>

                {isEditing ? (
                  <textarea
                    value={edited ?? draftText(section)}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [section.name]: e.target.value }))}
                    rows={Math.max(3, (edited ?? draftText(section)).split("\n").length + 1)}
                    className="mt-1 w-full rounded-md border border-slate-300 p-2 text-slate-900 focus:border-teal-600 focus:outline-none"
                  />
                ) : edited !== undefined || readOnly ? (
                  <p className="mt-1 whitespace-pre-line text-slate-800">
                    {(edited ?? draftText(section)) || <span className="text-slate-400">Nothing documented</span>}
                    {edited !== undefined && !readOnly && <span className="ml-2 text-sm text-amber-700">(edited)</span>}
                  </p>
                ) : section.sentences.length === 0 ? (
                  <p className="mt-1 text-slate-400">Nothing documented</p>
                ) : (
                  <ul className="mt-1 space-y-1">
                    {section.sentences.map((sentence, i) => {
                      const active = selected?.section === section.name && selected.index === i;
                      return (
                        <li key={i}>
                          <button
                            onClick={() => setSelected(active ? null : { section: section.name, index: i })}
                            className={`w-full rounded px-2 py-1 text-left text-slate-800 ${active ? "bg-amber-100" : "hover:bg-slate-50"}`}
                          >
                            {sentence.text}
                            {sentence.evidence.length === 0 && <span className="ml-2 text-sm text-slate-400">(no evidence link)</span>}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>

        {!readOnly && (
          <div className="border-t border-slate-200 px-5 py-4">
            <button
              onClick={() => onApprove(finalSections())}
              disabled={busy}
              className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
            >
              {busy ? "Starting…" : "Approve note & run assistant"}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
