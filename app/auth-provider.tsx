"use client";

import { Amplify } from "aws-amplify";
import { fetchAuthSession, signIn as amplifySignIn, signOut as amplifySignOut } from "aws-amplify/auth";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { config, missingConfig } from "@/lib/config";

if (missingConfig.length === 0) {
  Amplify.configure({
    Auth: { Cognito: { userPoolId: config.userPoolId, userPoolClientId: config.userPoolClientId } },
  });
}

export interface Doctor {
  name: string;
  doctorId: string;
  email: string;
}

type AuthState =
  | { status: "loading" }
  | { status: "signedOut" }
  | { status: "signedIn"; doctor: Doctor };

interface AuthContextValue {
  state: AuthState;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// Display only: the API derives identity from the verified token, not from this.
async function currentDoctor(): Promise<Doctor | null> {
  const session = await fetchAuthSession();
  const claims = session.tokens?.idToken?.payload;
  if (!claims) return null;
  return {
    name: String(claims.name ?? claims.email ?? "Clinician"),
    doctorId: String(claims["custom:doctor_id"] ?? ""),
    email: String(claims.email ?? ""),
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  // Restore an existing session (tokens persisted by Amplify) on first load.
  useEffect(() => {
    if (missingConfig.length > 0) return;
    let cancelled = false;
    currentDoctor().then(
      (doctor) => !cancelled && setState(doctor ? { status: "signedIn", doctor } : { status: "signedOut" }),
      () => !cancelled && setState({ status: "signedOut" }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await amplifySignIn({ username: email, password });
    if (!result.isSignedIn) {
      throw new Error(`Additional sign-in step required (${result.nextStep.signInStep}). Demo users should not need one.`);
    }
    const doctor = await currentDoctor();
    if (!doctor) throw new Error("Signed in, but no session was returned.");
    setState({ status: "signedIn", doctor });
  }, []);

  const signOut = useCallback(async () => {
    await amplifySignOut();
    setState({ status: "signedOut" });
  }, []);

  if (missingConfig.length > 0) {
    return (
      <div className="mx-auto max-w-xl p-8">
        <div className="rounded-lg border border-red-300 bg-red-50 p-5 text-red-900">
          <p className="font-semibold">Missing configuration</p>
          <p className="mt-2">Set these environment variables (see .env.example): {missingConfig.join(", ")}</p>
        </div>
      </div>
    );
  }

  return <AuthContext.Provider value={{ state, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
