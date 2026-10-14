import { randomUUID } from "node:crypto";
import { PutCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./ddb";
import { tables } from "./config";

export type AuditEvent =
  | "TOOL_ALLOWED"
  | "TOOL_DENIED"
  | "TOOL_INVALID_INPUT"
  | "ACTION_PROPOSED"
  | "ACTION_PROPOSAL_REJECTED"
  | "ACTION_APPROVED"
  | "ACTION_REJECTED"
  | "DECISION_DENIED"
  | "ACCESS_DENIED"
  | "FAILURE";

// IDs and decision codes only. No clinical text.
export interface AuditFields {
  actor: "agent-tool" | "clinician" | "application";
  doctorId?: string;
  patientId?: string;
  actionId?: string;
  toolName?: string;
  reason?: string;
}

export async function audit(encounterId: string, event: AuditEvent, fields: AuditFields): Promise<void> {
  const ts = new Date().toISOString();
  await ddb.send(
    new PutCommand({
      TableName: tables.audit,
      Item: { encounterId, sk: `${ts}#${randomUUID()}`, event, ts, ...fields },
    }),
  );
}
