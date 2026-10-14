import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { actionIdFor, isAssigned, ownsEncounter } from "./access";
import { audit } from "./audit";
import { tables } from "./config";
import { ddb } from "./ddb";
import { isConditionalCheckFailed } from "./errors";
import { log } from "./logger";
import { getEncounter, getPatient } from "./repo";
import type { Action, ActionType, ToolResult } from "./types";

interface ProposeArgs {
  fn: string;
  toolName: string;
  type: ActionType;
  encounterId: string;
  doctorId: string;
  patientId: string;
  payload: Record<string, unknown>;
}

// Shared by create_referral and schedule_recall. Writes a PENDING_APPROVAL
// action and nothing else: these Lambdas have PutItem but no UpdateItem on the
// Actions table, so they cannot change an action's status after it exists.
export async function proposeAction(args: ProposeArgs): Promise<ToolResult<Pick<Action, "actionId" | "status" | "type">>> {
  const { fn, toolName, type, encounterId, doctorId, patientId, payload } = args;
  const started = Date.now();

  const deny = async (reason: string, message: string): Promise<ToolResult<never>> => {
    await audit(encounterId, "ACTION_PROPOSAL_REJECTED", { actor: "agent-tool", doctorId, patientId, toolName, reason });
    log.warn("tool_denied", { fn, toolName, encounterId, doctorId, patientId, decision: reason, latencyMs: Date.now() - started });
    return { status: "DENIED", reason, message };
  };

  const [encounter, patient] = await Promise.all([getEncounter(encounterId), getPatient(patientId)]);

  if (!ownsEncounter(encounter, doctorId)) {
    return deny("ENCOUNTER_NOT_OWNED", "Access denied: this encounter does not belong to the clinician.");
  }
  if (encounter!.patientId !== patientId) {
    return deny("PATIENT_MISMATCH", "Actions can only be proposed for the patient on this encounter. Do not retry with another patient.");
  }
  if (!isAssigned(patient, doctorId)) {
    return deny("NOT_ASSIGNED", "Access denied: the clinician is not assigned to this patient.");
  }
  if (encounter!.status !== "AGENT_RUNNING") {
    return deny("WRONG_STATE", "Actions can only be proposed while the assistant is running.");
  }

  const action: Action = {
    actionId: actionIdFor(encounterId),
    encounterId,
    patientId,
    doctorId,
    type,
    status: "PENDING_APPROVAL",
    payload,
    draft: true,
    proposedBy: "agent",
    createdAt: new Date().toISOString(),
  };

  try {
    await ddb.send(
      new PutCommand({
        TableName: tables.actions,
        Item: action,
        ConditionExpression: "attribute_not_exists(actionId)",
      }),
    );
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      await audit(encounterId, "ACTION_PROPOSAL_REJECTED", { actor: "agent-tool", doctorId, patientId, toolName, actionId: action.actionId, reason: "ALREADY_PROPOSED" });
      log.warn("tool_conflict", { fn, toolName, encounterId, actionId: action.actionId, errorCode: "ALREADY_PROPOSED" });
      return { status: "CONFLICT", message: "A follow-up action has already been proposed for this encounter. Propose exactly one." };
    }
    throw err;
  }

  await audit(encounterId, "ACTION_PROPOSED", { actor: "agent-tool", doctorId, patientId, toolName, actionId: action.actionId });
  log.info("action_proposed", { fn, toolName, encounterId, doctorId, patientId, actionId: action.actionId, status: action.status, latencyMs: Date.now() - started });
  return { status: "OK", data: { actionId: action.actionId, status: action.status, type } };
}
