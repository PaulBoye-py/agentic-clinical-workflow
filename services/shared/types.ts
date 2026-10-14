export type DoctorId = string;

export interface Allergy {
  substance: string;
  reaction?: string;
  severity?: string;
  recorded?: string;
}

export interface ImagingRecord {
  imagingId: string;
  type: string;
  date: string;
  report: string;
}

export interface Patient {
  patientId: string;
  displayName: string;
  synthetic: boolean;
  dateOfBirth: string;
  sex: string;
  assignedDoctorIds: Set<DoctorId>;
  allergies: Allergy[];
  noKnownAllergies?: boolean;
  medicalHistory: string[];
  medications: string[];
  imaging: ImagingRecord[];
  lastCheckup?: string;
}

export const ENCOUNTER_STATUSES = [
  "CREATED",
  "AUDIO_UPLOADED",
  "TRANSCRIBING",
  "NOTE_READY",
  "NOTE_REVIEWED",
  "AGENT_RUNNING",
  "NEEDS_INPUT",
  "AWAITING_APPROVAL",
  "COMPLETED",
  "REJECTED",
  "FAILED",
] as const;
export type EncounterStatus = (typeof ENCOUNTER_STATUSES)[number];

export interface Encounter {
  encounterId: string;
  doctorId: DoctorId;
  patientId: string;
  status: EncounterStatus;
  nextStepSeq?: number;
  createdAt: string;
  updatedAt: string;
  error?: { code: string; message: string };
  [key: string]: unknown;
}

export type StepType =
  | "MODEL_TURN"
  | "TOOL_REQUEST"
  | "TOOL_RESULT"
  | "TOOL_DENIED"
  | "DETERMINISTIC_CHECK"
  | "QUESTION"
  | "ANSWER"
  | "ACTION_PROPOSED"
  | "APPROVED"
  | "REJECTED"
  | "ERROR";

export type Actor = "model" | "application" | "clinician";

export interface EncounterStep {
  encounterId: string;
  seq: string;
  type: StepType;
  actor: Actor;
  summary: string;
  toolName?: string;
  latencyMs?: number;
  model?: string;
  createdAt: string;
}

export type ActionType = "REFERRAL" | "RECALL";
export type ActionStatus = "PENDING_APPROVAL" | "APPROVED" | "REJECTED";

export interface Action {
  actionId: string;
  encounterId: string;
  patientId: string;
  doctorId: DoctorId;
  type: ActionType;
  status: ActionStatus;
  payload: Record<string, unknown>;
  draft: true;
  proposedBy: "agent";
  createdAt: string;
  decidedBy?: DoctorId;
  decidedAt?: string;
  rejectionReason?: string;
}

// Result envelope every tool Lambda returns to the agent worker.
export type ToolResult<T = unknown> =
  | { status: "OK"; data: T }
  | { status: "DENIED"; reason: string; message: string }
  | { status: "INVALID_INPUT"; message: string }
  | { status: "CONFLICT"; message: string };
