import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { ddb } from "./ddb";
import { tables } from "./config";
import type { Action, Encounter, Patient } from "./types";

async function get<T>(table: string, key: Record<string, string>): Promise<T | undefined> {
  const { Item } = await ddb.send(new GetCommand({ TableName: table, Key: key, ConsistentRead: true }));
  return Item as T | undefined;
}

export const getPatient = (patientId: string) => get<Patient>(tables.patients, { patientId });
export const getEncounter = (encounterId: string) => get<Encounter>(tables.encounters, { encounterId });
export const getAction = (actionId: string) => get<Action>(tables.actions, { actionId });
