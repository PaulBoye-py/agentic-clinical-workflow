import { isAssigned } from "../shared/access";
import { audit } from "../shared/audit";
import { log } from "../shared/logger";
import { getPatient } from "../shared/repo";
import { formatZodError, getPatientRecordInput, toolInvocation } from "../shared/schemas";
import type { Patient, ToolResult } from "../shared/types";

const FN = "tool-get-patient-record";
const TOOL = "get_patient_record";
const invocation = toolInvocation(getPatientRecordInput);

type PatientRecord = Omit<Patient, "assignedDoctorIds">;

export async function handler(event: unknown): Promise<ToolResult<PatientRecord>> {
  const started = Date.now();
  const parsed = invocation.safeParse(event);
  if (!parsed.success) {
    log.warn("tool_invalid_input", { fn: FN, toolName: TOOL, errorCode: "INVALID_INPUT" });
    return { status: "INVALID_INPUT", message: formatZodError(parsed.error) };
  }
  const { encounterId, doctorId, input } = parsed.data;
  const patient = await getPatient(input.patientId);

  // Not found and not assigned look identical to the caller, so the tool
  // cannot be used to discover which patient IDs exist.
  if (!isAssigned(patient, doctorId)) {
    await audit(encounterId, "TOOL_DENIED", {
      actor: "agent-tool",
      doctorId,
      patientId: input.patientId,
      toolName: TOOL,
      reason: patient ? "NOT_ASSIGNED" : "NOT_FOUND",
    });
    log.warn("tool_denied", { fn: FN, toolName: TOOL, encounterId, doctorId, patientId: input.patientId, decision: "DENIED", latencyMs: Date.now() - started });
    return {
      status: "DENIED",
      reason: "NOT_ASSIGNED",
      message:
        "Access denied: the clinician on this encounter is not assigned to this patient. Do not retry or look for another way to obtain this record.",
    };
  }

  await audit(encounterId, "TOOL_ALLOWED", { actor: "agent-tool", doctorId, patientId: input.patientId, toolName: TOOL });
  log.info("tool_allowed", { fn: FN, toolName: TOOL, encounterId, doctorId, patientId: input.patientId, decision: "ALLOWED", latencyMs: Date.now() - started });

  const { assignedDoctorIds: _omit, ...record } = patient!;
  return { status: "OK", data: record };
}
