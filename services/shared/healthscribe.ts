import { z } from "zod";

// Parsed forms of the two HealthScribe output files, as stored on the encounter
// and shown side by side in the UI.

export interface TranscriptSegment {
  segmentId: string;
  role: "CLINICIAN" | "PATIENT" | "UNKNOWN";
  participant: string; // e.g. CLINICIAN_0
  text: string;
  startSec: number;
  endSec: number;
  section?: string; // SUBJECTIVE | OBJECTIVE | ASSESSMENT_AND_PLAN | OTHER ...
}

export interface NoteSentence {
  text: string;
  evidence: string[]; // SegmentIds in the transcript
}

export interface NoteSection {
  name: string; // e.g. CHIEF_COMPLAINT
  sentences: NoteSentence[];
}

// Loose schemas: only the fields we use, unknown fields ignored.
const transcriptFile = z.object({
  Conversation: z.object({
    TranscriptSegments: z.array(
      z.object({
        SegmentId: z.string(),
        Content: z.string(),
        BeginAudioTime: z.number(),
        EndAudioTime: z.number(),
        ParticipantDetails: z.object({ ParticipantRole: z.string() }).optional(),
        SectionDetails: z.object({ SectionName: z.string() }).optional(),
      }),
    ),
  }),
});

const clinicalDocumentFile = z.object({
  ClinicalDocumentation: z.object({
    Sections: z.array(
      z.object({
        SectionName: z.string(),
        Summary: z.array(
          z.object({
            SummarizedSegment: z.string(),
            EvidenceLinks: z.array(z.object({ SegmentId: z.string() })).default([]),
          }),
        ),
      }),
    ),
  }),
});

function roleOf(participant: string): TranscriptSegment["role"] {
  if (participant.startsWith("CLINICIAN")) return "CLINICIAN";
  if (participant.startsWith("PATIENT")) return "PATIENT";
  return "UNKNOWN";
}

export function parseTranscript(raw: unknown): TranscriptSegment[] {
  const doc = transcriptFile.parse(raw);
  return doc.Conversation.TranscriptSegments.map((s) => {
    const participant = s.ParticipantDetails?.ParticipantRole ?? "UNKNOWN";
    return {
      segmentId: s.SegmentId,
      role: roleOf(participant),
      participant,
      text: s.Content,
      startSec: s.BeginAudioTime,
      endSec: s.EndAudioTime,
      section: s.SectionDetails?.SectionName,
    };
  });
}

export function parseClinicalDocument(raw: unknown): NoteSection[] {
  const doc = clinicalDocumentFile.parse(raw);
  // Summary lines can carry list markers ("- ") and trailing newlines.
  return doc.ClinicalDocumentation.Sections.map((s) => ({
    name: s.SectionName,
    sentences: s.Summary.map((x) => ({
      text: x.SummarizedSegment.trim().replace(/^-\s+/, ""),
      evidence: x.EvidenceLinks.map((l) => l.SegmentId),
    })).filter((x) => x.text.length > 0),
  }));
}

// HealthScribe reports output as an S3 URL. Accepts s3://bucket/key and the
// https path-style / virtual-hosted forms; returns the key in the expected bucket.
export function s3KeyFromUri(uri: string, bucket: string): string {
  if (uri.startsWith("s3://")) {
    const rest = uri.slice(5);
    const slash = rest.indexOf("/");
    if (rest.slice(0, slash) !== bucket) throw new Error("Output is not in the media bucket");
    return decodeURIComponent(rest.slice(slash + 1));
  }
  const url = new URL(uri);
  const path = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.hostname.startsWith(`${bucket}.`)) return path;
  if (path.startsWith(`${bucket}/`)) return path.slice(bucket.length + 1);
  throw new Error("Output is not in the media bucket");
}
