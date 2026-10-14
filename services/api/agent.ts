import { InvokeCommand, LambdaClient } from "@aws-sdk/client-lambda";
import { QueryCommand } from "@aws-sdk/lib-dynamodb";
import { env, tables } from "../shared/config";
import { ddb } from "../shared/ddb";
import { getOwnedEncounter, markFailed, transition } from "../shared/encounters";
import { errors } from "../shared/errors";
import { json, parseBody, type ApiEvent, type ApiResult, type Caller } from "../shared/http";
import { log } from "../shared/logger";
import { agentReplyBody, encounterIdSchema } from "../shared/schemas";
import { appendStep } from "../shared/steps";

const lambda = new LambdaClient({});

function encounterIdFrom(event: ApiEvent): string {
  const parsed = encounterIdSchema.safeParse(event.pathParameters?.encounterId);
  if (!parsed.success) throw errors.validation("Invalid encounter ID.");
  return parsed.data;
}

// Asynchronous invoke: the worker writes its progress to the timeline, which
// the UI polls. Retries are disabled on the function so a run never repeats.
async function startWorker(encounterId: string, mode: "start" | "resume"): Promise<void> {
  try {
    await lambda.send(
      new InvokeCommand({
        FunctionName: env.required("AGENT_WORKER_FN"),
        InvocationType: "Event",
        Payload: Buffer.from(JSON.stringify({ encounterId, mode })),
      }),
    );
  } catch (err) {
    const code = err instanceof Error ? err.name : "Unknown";
    log.error("worker_invoke_failed", { encounterId, errorCode: code });
    await markFailed(encounterId, "AGENT_START_FAILED", `The assistant could not be started (${code}).`);
    throw errors.conflict(`The assistant could not be started (${code}).`);
  }
}

// ---- POST /encounters/{encounterId}/agent/run ----

export async function runAgent(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  await getOwnedEncounter(encounterId, caller.doctorId);
  // Conditional: only a reviewed note can start the assistant, and only once.
  const updated = await transition(encounterId, ["NOTE_REVIEWED"], "AGENT_RUNNING", {
    agentStartedAt: new Date().toISOString(),
    agentStartedBy: caller.doctorId,
    questionsAsked: 0,
    clinicianAnswers: [],
  });
  await startWorker(encounterId, "start");
  log.info("agent_started", { encounterId, doctorId: caller.doctorId });
  return json(202, { encounter: { encounterId, status: updated.status } });
}

// ---- POST /encounters/{encounterId}/agent/reply ----

export async function replyToAgent(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  const encounter = await getOwnedEncounter(encounterId, caller.doctorId);
  const { answer } = parseBody(event, agentReplyBody);
  if (encounter.status !== "NEEDS_INPUT") throw errors.conflict("The assistant is not waiting for an answer.");

  const answers = [...((encounter.clinicianAnswers as string[] | undefined) ?? []), answer];
  await transition(encounterId, ["NEEDS_INPUT"], "AGENT_RUNNING", {
    pendingAnswer: answer,
    pendingQuestion: null,
    clinicianAnswers: answers,
  });
  await appendStep({ encounterId, type: "ANSWER", actor: "clinician", summary: answer });
  await startWorker(encounterId, "resume");
  log.info("agent_resumed", { encounterId, doctorId: caller.doctorId });
  return json(202, { encounter: { encounterId, status: "AGENT_RUNNING" } });
}

// ---- GET /encounters/{encounterId}/audit ----

export async function getAudit(event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const encounterId = encounterIdFrom(event);
  await getOwnedEncounter(encounterId, caller.doctorId);
  const { Items = [] } = await ddb.send(
    new QueryCommand({ TableName: tables.audit, KeyConditionExpression: "encounterId = :e", ExpressionAttributeValues: { ":e": encounterId } }),
  );
  return json(200, { audit: Items });
}
