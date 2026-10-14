import type { Tool } from "@aws-sdk/client-bedrock-runtime";
import { z } from "zod";
import { createReferralInput, getPatientRecordInput, scheduleRecallInput } from "../shared/schemas";

export const checkNoteCompletenessInput = z.strictObject({});

export const requestClinicianInput = z.strictObject({
  question: z.string().trim().min(1).max(600),
  missingItems: z.array(z.string().trim().min(1).max(120)).max(10),
});

export const TOOL_INPUTS = {
  get_patient_record: getPatientRecordInput,
  check_note_completeness: checkNoteCompletenessInput,
  request_clinician_input: requestClinicianInput,
  create_referral: createReferralInput,
  schedule_recall: scheduleRecallInput,
} as const;

export type ToolName = keyof typeof TOOL_INPUTS;

const DESCRIPTIONS: Record<ToolName, string> = {
  get_patient_record:
    "Retrieve a patient's record: demographics, allergies, medical history, current medications and imaging. Access is checked by the application; a DENIED result means you must not try again.",
  check_note_completeness:
    "Deterministic check (not AI) of the clinician-reviewed note against required items: chief complaint, history of presenting complaint, medical history, allergies, current medications, examination findings, assessment and plan. Returns missing items and record items the note omits.",
  request_clinician_input:
    "Pause and ask the clinician a question. Use for missing information; the clinician's answer is returned as the result. Ask one question covering all missing items.",
  create_referral:
    "Propose a referral as a DRAFT. It is stored as PENDING_APPROVAL and only takes effect if the clinician approves it. Propose at most one follow-up action per consultation.",
  schedule_recall:
    "Propose a recall (routine review) as a DRAFT. It is stored as PENDING_APPROVAL and only takes effect if the clinician approves it. Propose at most one follow-up action per consultation.",
};

function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _drop, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

// Generated from the same zod schemas the tools validate with, so the schema
// the model sees cannot drift from what is enforced.
export const toolSpecs: Tool[] = (Object.keys(TOOL_INPUTS) as ToolName[]).map((name) => ({
  toolSpec: {
    name,
    description: DESCRIPTIONS[name],
    inputSchema: { json: jsonSchema(TOOL_INPUTS[name]) as never },
  },
}));

export const isToolName = (name: string): name is ToolName => name in TOOL_INPUTS;
