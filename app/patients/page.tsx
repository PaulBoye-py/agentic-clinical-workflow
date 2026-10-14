"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { apiFetch, type PatientSummary } from "@/lib/api";
import { useAuth } from "../auth-provider";

type Load =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; patients: PatientSummary[] };

function age(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  if (now < new Date(now.getFullYear(), dob.getMonth(), dob.getDate())) years--;
  return years;
}

export default function PatientsPage() {
  const { state } = useAuth();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ status: "loading" });

  useEffect(() => {
    if (state.status === "signedOut") router.replace("/login/");
    if (state.status !== "signedIn") return;
    apiFetch<{ patients: PatientSummary[] }>("/patients")
      .then((r) => setLoad({ status: "ready", patients: r.patients }))
      .catch((err: Error) => setLoad({ status: "error", message: err.message }));
  }, [state.status, router]);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">My patients</h1>
      <p className="mt-1 text-slate-600">Only patients assigned to you are listed.</p>

      {load.status === "loading" && <p className="mt-8 text-slate-500">Loading patients…</p>}

      {load.status === "error" && (
        <p role="alert" className="mt-8 rounded-md border border-red-300 bg-red-50 px-4 py-3 text-red-900">
          Could not load patients: {load.message}
        </p>
      )}

      {load.status === "ready" && load.patients.length === 0 && (
        <p className="mt-8 text-slate-600">No patients are assigned to you.</p>
      )}

      {load.status === "ready" && load.patients.length > 0 && (
        <ul className="mt-6 divide-y divide-slate-200 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {load.patients.map((p) => (
            <li key={p.patientId} className="flex items-center justify-between gap-4 px-5 py-4">
              <div>
                <p className="font-medium text-slate-900">{p.displayName}</p>
                <p className="mt-0.5 text-slate-600">
                  <span className="font-mono text-sm">{p.patientId}</span>
                  <span className="mx-2 text-slate-300">·</span>
                  {age(p.dateOfBirth)} y, {p.sex}
                  {p.lastCheckup && (
                    <>
                      <span className="mx-2 text-slate-300">·</span>
                      Last check-up {p.lastCheckup}
                    </>
                  )}
                </p>
              </div>
              <Link
                href={`/encounter/?patient=${encodeURIComponent(p.patientId)}`}
                className="rounded-md bg-teal-700 px-4 py-2 font-medium text-white hover:bg-teal-800"
              >
                New consultation
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
