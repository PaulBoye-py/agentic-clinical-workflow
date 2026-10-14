import { ScanCommand } from "@aws-sdk/lib-dynamodb";
import { tables } from "../shared/config";
import { ddb } from "../shared/ddb";
import { errors } from "../shared/errors";
import { callerFrom, handleApi, json, type ApiEvent, type ApiResult, type Caller } from "../shared/http";
import type { Patient } from "../shared/types";
import { createEncounter, getEncounterRoute, saveReviewedNote, startTranscription } from "./encounters";

const FN = "api";

type Route = (event: ApiEvent, caller: Caller) => Promise<ApiResult>;

const routes: Record<string, Route> = {
  "GET /patients": listPatients,
  "POST /encounters": createEncounter,
  "GET /encounters/{encounterId}": getEncounterRoute,
  "POST /encounters/{encounterId}/transcribe": startTranscription,
  "PUT /encounters/{encounterId}/note": saveReviewedNote,
};

export async function handler(event: ApiEvent): Promise<ApiResult> {
  return handleApi(FN, event, async () => {
    const caller = callerFrom(event);
    const route = routes[event.routeKey];
    if (!route) throw errors.notFound("Route");
    return route(event, caller);
  });
}

// Summary only: the full record is reached through the agent tool, which audits access.
async function listPatients(_event: ApiEvent, caller: Caller): Promise<ApiResult> {
  const { Items = [] } = await ddb.send(
    new ScanCommand({
      TableName: tables.patients,
      FilterExpression: "contains(assignedDoctorIds, :doc)",
      ExpressionAttributeValues: { ":doc": caller.doctorId },
      ProjectionExpression: "patientId, displayName, synthetic, dateOfBirth, sex, lastCheckup",
    }),
  );
  const patients = (Items as Partial<Patient>[]).sort((a, b) => String(a.patientId).localeCompare(String(b.patientId)));
  return json(200, { patients });
}
