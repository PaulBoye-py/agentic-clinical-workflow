import { TransactWriteCommand } from "@aws-sdk/lib-dynamodb";
import { canDecideAction } from "../shared/access";
import { audit } from "../shared/audit";
import { tables } from "../shared/config";
import { ddb } from "../shared/ddb";
import { errors, isTransactionConditionFailed } from "../shared/errors";
import { callerFrom, handleApi, json, parseBody, type ApiEvent, type ApiResult } from "../shared/http";
import { getAction, getEncounter } from "../shared/repo";
import { actionIdSchema, rejectBody } from "../shared/schemas";
import { appendStep } from "../shared/steps";

const FN = "approve-action";

// The only code path that moves an action to APPROVED or REJECTED. It is
// reachable only through API Gateway with a clinician's ID token; the agent
// worker's role has no permission to invoke it or to update Actions.
export async function handler(event: ApiEvent): Promise<ApiResult> {
  return handleApi(FN, event, async () => {
    const caller = callerFrom(event);
    const decision = event.routeKey.endsWith("/approve") ? "APPROVED" : "REJECTED";

    const idParse = actionIdSchema.safeParse(event.pathParameters?.actionId);
    if (!idParse.success) throw errors.validation("Invalid action ID.");
    const actionId = idParse.data;
    const body = decision === "REJECTED" ? parseBody(event, rejectBody) : undefined;

    const action = await getAction(actionId);
    if (!action) throw errors.notFound("Action");
    const encounter = await getEncounter(action.encounterId);

    if (!canDecideAction(action, encounter, caller.doctorId)) {
      await audit(action.encounterId, "DECISION_DENIED", { actor: "clinician", doctorId: caller.doctorId, actionId, reason: "NOT_ENCOUNTER_DOCTOR" });
      throw errors.forbidden("Only the clinician on this encounter can decide this action.");
    }

    const now = new Date().toISOString();
    const finalEncounterStatus = decision === "APPROVED" ? "COMPLETED" : "REJECTED";

    try {
      await ddb.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Update: {
                TableName: tables.actions,
                Key: { actionId },
                UpdateExpression: "SET #s = :decision, decidedBy = :doc, decidedAt = :now" + (body?.reason ? ", rejectionReason = :reason" : ""),
                ConditionExpression: "#s = :pending AND doctorId = :doc",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                  ":decision": decision,
                  ":doc": caller.doctorId,
                  ":now": now,
                  ":pending": "PENDING_APPROVAL",
                  ...(body?.reason ? { ":reason": body.reason } : {}),
                },
              },
            },
            {
              Update: {
                TableName: tables.encounters,
                Key: { encounterId: action.encounterId },
                UpdateExpression: "SET #s = :final, updatedAt = :now",
                ConditionExpression: "#s = :awaiting AND doctorId = :doc",
                ExpressionAttributeNames: { "#s": "status" },
                ExpressionAttributeValues: {
                  ":final": finalEncounterStatus,
                  ":awaiting": "AWAITING_APPROVAL",
                  ":doc": caller.doctorId,
                  ":now": now,
                },
              },
            },
          ],
        }),
      );
    } catch (err) {
      if (isTransactionConditionFailed(err)) {
        throw errors.conflict("This action has already been decided or is not awaiting approval.");
      }
      throw err;
    }

    await appendStep({
      encounterId: action.encounterId,
      type: decision,
      actor: "clinician",
      summary: `${caller.name ?? caller.doctorId} ${decision === "APPROVED" ? "approved" : "rejected"} the proposed ${action.type.toLowerCase()}.`,
    });
    await audit(action.encounterId, decision === "APPROVED" ? "ACTION_APPROVED" : "ACTION_REJECTED", {
      actor: "clinician",
      doctorId: caller.doctorId,
      patientId: action.patientId,
      actionId,
    });

    return json(200, { actionId, status: decision, decidedBy: caller.doctorId, decidedAt: now });
  });
}
