"use client";

import Link from "next/link";
import { useAuth } from "./auth-provider";

export function AppHeader() {
  const { state, signOut } = useAuth();

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/patients/" className="text-lg font-semibold text-slate-900">
            Clinical Assistant
          </Link>
          <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-sm font-medium text-amber-900">
            Synthetic data only
          </span>
        </div>
        {state.status === "signedIn" && (
          <div className="flex items-center gap-4">
            <span className="text-slate-700">
              {state.doctor.name}
              <span className="ml-2 font-mono text-sm text-slate-500">{state.doctor.doctorId}</span>
            </span>
            <button
              onClick={() => void signOut()}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
