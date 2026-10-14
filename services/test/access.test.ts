import { describe, expect, it } from "vitest";
import { actionIdFor, canDecideAction, isAssigned, ownsEncounter } from "../shared/access";

describe("isAssigned", () => {
  const patient = { assignedDoctorIds: new Set(["DR-A"]) };
  it("allows the assigned doctor", () => expect(isAssigned(patient, "DR-A")).toBe(true));
  it("denies another doctor", () => expect(isAssigned(patient, "DR-B")).toBe(false));
  it("denies a missing patient", () => expect(isAssigned(undefined, "DR-A")).toBe(false));
});

describe("ownsEncounter", () => {
  it("matches only the encounter's doctor", () => {
    expect(ownsEncounter({ doctorId: "DR-A" }, "DR-A")).toBe(true);
    expect(ownsEncounter({ doctorId: "DR-A" }, "DR-B")).toBe(false);
    expect(ownsEncounter(undefined, "DR-A")).toBe(false);
  });
});

describe("canDecideAction", () => {
  const encounter = { encounterId: "ENC-1", doctorId: "DR-A" };
  const action = { encounterId: "ENC-1", doctorId: "DR-A" };
  it("allows the encounter's doctor", () => expect(canDecideAction(action, encounter, "DR-A")).toBe(true));
  it("denies another doctor", () => expect(canDecideAction(action, encounter, "DR-B")).toBe(false));
  it("denies when action and encounter disagree", () => {
    expect(canDecideAction({ ...action, encounterId: "ENC-2" }, encounter, "DR-A")).toBe(false);
    expect(canDecideAction(action, { ...encounter, doctorId: "DR-B" }, "DR-A")).toBe(false);
  });
});

describe("actionIdFor", () => {
  it("derives one action ID per encounter", () => expect(actionIdFor("ENC-abc123")).toBe("ACT-ENC-abc123"));
});
