"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "./auth-provider";

export default function Home() {
  const { state } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "signedIn") router.replace("/patients/");
    if (state.status === "signedOut") router.replace("/login/");
  }, [state.status, router]);

  return <p className="text-slate-500">Loading…</p>;
}
