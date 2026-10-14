import { randomBytes } from "node:crypto";
import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ownsEncounter } from "./access";
import { audit } from "./audit";
import { tables } from "./config";
import { ddb } from "./ddb";
import { errors, isConditionalCheckFailed } from "./errors";
import { getEncounter } from "./repo";
import type { Encounter, EncounterStatus } from "./types";

export function newEncounterId(): string {
  return `ENC-${Date.now().toString(36)}-${randomBytes(5).toString("hex")}`;
}

// Loads an encounter and enforces that the caller is its doctor. Denials are audited.
export async function getOwnedEncounter(encounterId: string, doctorId: string): Promise<Encounter> {
  const encounter = await getEncounter(encounterId);
  if (!encounter) throw errors.notFound("Encounter");
  if (!ownsEncounter(encounter, doctorId)) {
    await audit(encounterId, "ACCESS_DENIED", { actor: "clinician", doctorId, reason: "NOT_ENCOUNTER_DOCTOR" });
    throw errors.forbidden("This encounter belongs to another clinician.");
  }
  return encounter;
}

// Valid transitions of the encounter status machine. FAILED is reachable from
// any non-terminal state through markFailed().
const ALLOWED: Record<EncounterStatus, EncounterStatus[]> = {
  CREATED: ["AUDIO_UPLOADED"],
  AUDIO_UPLOADED: ["TRANSCRIBING"],
  TRANSCRIBING: ["NOTE_READY"],
  NOTE_READY: ["NOTE_REVIEWED"],
  NOTE_REVIEWED: ["NOTE_REVIEWED", "AGENT_RUNNING"],
  AGENT_RUNNING: ["NEEDS_INPUT", "AWAITING_APPROVAL"],
  NEEDS_INPUT: ["AGENT_RUNNING"],
  AWAITING_APPROVAL: ["COMPLETED", "REJECTED"],
  COMPLETED: [],
  REJECTED: [],
  FAILED: [],
};

export function canTransition(from: EncounterStatus, to: EncounterStatus): boolean {
  return ALLOWED[from].includes(to);
}

// Conditional write: succeeds only if the stored status is one of `from` and
// each of those may move to `to`. Concurrent or out-of-order requests get 409.
export async function transition(
  encounterId: string,
  from: EncounterStatus[],
  to: EncounterStatus,
  set: Record<string, unknown> = {},
): Promise<Encounter> {
  for (const f of from) {
    if (!canTransition(f, to)) throw new Error(`Invalid transition ${f} -> ${to}`);
  }
  const names: Record<string, string> = { "#s": "status", "#u": "updatedAt" };
  const values: Record<string, unknown> = { ":to": to, ":now": new Date().toISOString() };
  const sets = ["#s = :to", "#u = :now"];
  Object.entries(set).forEach(([k, v], i) => {
    names[`#f${i}`] = k;
    values[`:v${i}`] = v;
    sets.push(`#f${i} = :v${i}`);
  });
  const fromKeys = from.map((f, i) => {
    values[`:from${i}`] = f;
    return `:from${i}`;
  });

  try {
    const { Attributes } = await ddb.send(
      new UpdateCommand({
        TableName: tables.encounters,
        Key: { encounterId },
        UpdateExpression: `SET ${sets.join(", ")}`,
        ConditionExpression: `#s IN (${fromKeys.join(", ")})`,
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        ReturnValues: "ALL_NEW",
      }),
    );
    return Attributes as Encounter;
  } catch (err) {
    if (isConditionalCheckFailed(err)) {
      throw errors.conflict(`This step is not available while the encounter is in its current state.`);
    }
    throw err;
  }
}

// Moves any non-terminal encounter to FAILED with a message that is safe to
// show in the UI. Returns false if it was already terminal.
export async function markFailed(encounterId: string, code: string, message: string): Promise<boolean> {
  try {
    await ddb.send(
      new UpdateCommand({
        TableName: tables.encounters,
        Key: { encounterId },
        UpdateExpression: "SET #s = :failed, #e = :err, updatedAt = :now",
        ConditionExpression: "NOT #s IN (:c, :r, :failed)",
        ExpressionAttributeNames: { "#s": "status", "#e": "error" },
        ExpressionAttributeValues: {
          ":failed": "FAILED",
          ":c": "COMPLETED",
          ":r": "REJECTED",
          ":err": { code, message },
          ":now": new Date().toISOString(),
        },
      }),
    );
    return true;
  } catch (err) {
    if (isConditionalCheckFailed(err)) return false;
    throw err;
  }
}
