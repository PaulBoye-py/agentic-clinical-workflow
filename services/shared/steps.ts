import { PutCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./ddb";
import { tables } from "./config";
import type { EncounterStep } from "./types";

// Timeline steps are ordered by an atomic counter on the encounter, so steps
// written by different Lambdas (worker, API, approve-action) never collide.
export async function appendStep(step: Omit<EncounterStep, "seq" | "createdAt">): Promise<EncounterStep> {
  const { Attributes } = await ddb.send(
    new UpdateCommand({
      TableName: tables.encounters,
      Key: { encounterId: step.encounterId },
      UpdateExpression: "ADD nextStepSeq :one",
      ConditionExpression: "attribute_exists(encounterId)",
      ExpressionAttributeValues: { ":one": 1 },
      ReturnValues: "UPDATED_NEW",
    }),
  );
  const seq = String(Attributes?.nextStepSeq ?? 0).padStart(6, "0");
  const full: EncounterStep = { ...step, seq, createdAt: new Date().toISOString() };
  await ddb.send(new PutCommand({ TableName: tables.steps, Item: full }));
  return full;
}
