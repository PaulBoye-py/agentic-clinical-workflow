"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Encounter } from "@/lib/types";
import { audioContentType, uploadWithProgress } from "@/lib/upload";

type Layout = "STEREO_CLINICIAN_LEFT" | "MONO";

interface CreateResponse {
  encounter: Encounter;
  upload: { url: string; headers: Record<string, string> };
}

export function NewConsultation({ patientId, onUploaded }: { patientId: string; onUploaded: (encounterId: string) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [layout, setLayout] = useState<Layout>("STEREO_CLINICIAN_LEFT");
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const contentType = file ? audioContentType(file) : undefined;

  async function start() {
    if (!file || !contentType) return;
    setError(null);
    setProgress(0);
    try {
      const created = await apiFetch<CreateResponse>("/encounters", {
        method: "POST",
        body: { patientId, contentType, audioLayout: layout },
      });
      await uploadWithProgress(created.upload.url, file, created.upload.headers, setProgress);
      onUploaded(created.encounter.encounterId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setProgress(null);
    }
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-semibold text-slate-900">1. Upload consultation audio</h2>
      <p className="mt-1 text-slate-600">Synthetic recordings only. WAV or FLAC recommended.</p>

      <div className="mt-5 space-y-4">
        <input
          type="file"
          accept=".wav,.flac,.mp3,.m4a,.ogg,.webm"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={progress !== null}
          className="block w-full text-slate-700 file:mr-4 file:rounded-md file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-slate-800 hover:file:bg-slate-200"
        />
        {file && !contentType && <p className="text-red-700">Unsupported file type.</p>}

        <fieldset className="space-y-2">
          <legend className="text-slate-700">Audio channels</legend>
          <label className="flex items-center gap-2 text-slate-800">
            <input type="radio" checked={layout === "STEREO_CLINICIAN_LEFT"} onChange={() => setLayout("STEREO_CLINICIAN_LEFT")} />
            Stereo: clinician on left, patient on right
          </label>
          <label className="flex items-center gap-2 text-slate-800">
            <input type="radio" checked={layout === "MONO"} onChange={() => setLayout("MONO")} />
            Single channel (speaker detection)
          </label>
        </fieldset>

        {progress !== null && (
          <div>
            <div className="h-2 w-full overflow-hidden rounded bg-slate-100">
              <div className="h-full bg-teal-600 transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <p className="mt-1 text-sm text-slate-600">Uploading to S3… {Math.round(progress * 100)}%</p>
          </div>
        )}

        {error && (
          <p role="alert" className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-red-900">
            {error}
          </p>
        )}

        <button
          onClick={() => void start()}
          disabled={!file || !contentType || progress !== null}
          className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800 disabled:opacity-50"
        >
          Upload audio
        </button>
      </div>
    </div>
  );
}
