import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkNoteCompleteness, type RecordFacts } from "../agent-worker/completeness";
import { toolSpecs } from "../agent-worker/tools";
import { parseClinicalDocument } from "../shared/healthscribe";

// The SYNTHETIC PT-001 draft note from HealthScribe, approved unchanged.
const pt001Note = parseClinicalDocument(
  JSON.parse(readFileSync(new URL("./fixtures/pt001-summary-hp.json", import.meta.url), "utf8")),
).map((s) => ({ name: s.name, text: s.sentences.map((x) => x.text).join("\n") }));

const pt001Record: RecordFacts = {
  allergies: [{ substance: "Penicillin", reaction: "Urticarial rash" }],
  imaging: [{ imagingId: "IMG-PT001-OPG-20260928", type: "OPG", date: "2026-09-28" }],
};

describe("checkNoteCompleteness (scenario A note)", () => {
  it("flags current medications as missing and surfaces the recorded allergy", () => {
    const r = checkNoteCompleteness(pt001Note, [], pt001Record);
    expect(r.complete).toBe(false);
    expect(r.missing).toEqual(["current medications"]);
    expect(r.inRecordNotInNote).toEqual(["allergies: Penicillin (Urticarial rash)"]);
  });

  it("is complete once the clinician answers about medications", () => {
    const r = checkNoteCompleteness(pt001Note, ["No current medications."], pt001Record);
    expect(r.complete).toBe(true);
    expect(r.missing).toEqual([]);
  });

  it("asks about allergies when neither note nor record has them", () => {
    const r = checkNoteCompleteness(pt001Note, [], { allergies: [], imaging: [] });
    expect(r.missing).toEqual(["allergies", "current medications"]);
  });

  it("accepts a record that says no known allergies", () => {
    const r = checkNoteCompleteness(pt001Note, ["no meds"], { allergies: [], noKnownAllergies: true, imaging: [] });
    expect(r.complete).toBe(true);
  });
});

describe("checkNoteCompleteness (scenario B style note)", () => {
  it("passes when the note documents medications and allergies", () => {
    const note = [
      { name: "CHIEF_COMPLAINT", text: "Dental checkup" },
      { name: "HISTORY_OF_PRESENT_ILLNESS", text: "They deny any new medical conditions, medications, or allergies." },
      { name: "PAST_MEDICAL_HISTORY", text: "Patient denies taking any medications" },
      { name: "PHYSICAL_EXAMINATION", text: "Small cavity on the upper left first molar" },
      { name: "ASSESSMENT", text: "Dental caries" },
      { name: "PLAN", text: "Scheduled routine dental checkup in 6 months" },
    ];
    expect(checkNoteCompleteness(note, [], { allergies: [], noKnownAllergies: true, imaging: [] }).complete).toBe(true);
  });

  it("flags empty required sections", () => {
    const r = checkNoteCompleteness([{ name: "PLAN", text: "" }], ["no allergies, no medications"], undefined);
    expect(r.missing).toEqual(expect.arrayContaining(["chief complaint", "examination findings", "assessment", "plan"]));
  });
});

describe("tool specs", () => {
  it("exposes exactly the five tools", () =>
    expect(toolSpecs.map((t) => t.toolSpec?.name).sort()).toEqual(
      ["check_note_completeness", "create_referral", "get_patient_record", "request_clinician_input", "schedule_recall"],
    ));
  it("schemas reject extra properties (no doctorId from the model)", () => {
    for (const t of toolSpecs) expect((t.toolSpec?.inputSchema?.json as { additionalProperties?: boolean }).additionalProperties).toBe(false);
  });
});
