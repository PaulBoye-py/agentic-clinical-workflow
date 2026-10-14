// Shapes returned by the API (mirrors services/shared, view-only fields).

export type EncounterStatus =
  | "CREATED"
  | "AUDIO_UPLOADED"
  | "TRANSCRIBING"
  | "NOTE_READY"
  | "NOTE_REVIEWED"
  | "AGENT_RUNNING"
  | "NEEDS_INPUT"
  | "AWAITING_APPROVAL"
  | "COMPLETED"
  | "REJECTED"
  | "FAILED";

export interface TranscriptSegment {
  segmentId: string;
  role: "CLINICIAN" | "PATIENT" | "UNKNOWN";
  participant: string;
  text: string;
  startSec: number;
  endSec: number;
  section?: string;
}

export interface NoteSection {
  name: string;
  sentences: { text: string; evidence: string[] }[];
}

export interface ReviewedSection {
  name: string;
  text: string;
}

export interface Encounter {
  encounterId: string;
  doctorId: string;
  patientId: string;
  status: EncounterStatus;
  createdAt: string;
  updatedAt: string;
  audioLayout?: "STEREO_CLINICIAN_LEFT" | "MONO";
  transcript?: TranscriptSegment[];
  draftNote?: NoteSection[];
  reviewedNote?: { sections: ReviewedSection[] };
  scribe?: { template?: string; jobDurationMs?: number };
  transcribeStartedAt?: string;
  error?: { code: string; message: string };
  pendingQuestion?: { question: string; missingItems: string[] } | null;
  agentSummary?: string;
  agentModel?: string;
}

export interface AuditEvent {
  sk: string;
  ts: string;
  event: string;
  actor: string;
  doctorId?: string;
  patientId?: string;
  actionId?: string;
  toolName?: string;
  reason?: string;
}

export interface EncounterStep {
  seq: string;
  type: string;
  actor: "model" | "application" | "clinician";
  summary: string;
  toolName?: string;
  latencyMs?: number;
  model?: string;
  createdAt: string;
}

export interface Action {
  actionId: string;
  type: "REFERRAL" | "RECALL";
  status: "PENDING_APPROVAL" | "APPROVED" | "REJECTED";
  payload: Record<string, unknown>;
  decidedBy?: string;
  decidedAt?: string;
}

export interface EncounterView {
  encounter: Encounter;
  steps: EncounterStep[];
  actions: Action[];
}

export const sectionLabel = (name: string) =>
  name.charAt(0) + name.slice(1).toLowerCase().replace(/_/g, " ");
