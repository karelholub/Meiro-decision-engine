"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, DevLoginProfile, apiClient, setApiUserEmail, USER_EMAIL_STORAGE_KEY } from "../../lib/api";
import { setEnvironment } from "../../lib/environment";

const presets: Array<{ profile: DevLoginProfile; email: string; label: string; detail: string }> = [
  { profile: "viewer", email: "viewer.dev@decisioning.local", label: "Viewer", detail: "Read-only in all environments" },
  { profile: "builder", email: "builder.dev@decisioning.local", label: "Builder", detail: "Write in DEV, view in STAGE/PROD" },
  {
    profile: "publisher",
    email: "publisher.dev@decisioning.local",
    label: "Publisher",
    detail: "Activate and promote in DEV/STAGE, view PROD"
  },
  { profile: "operator", email: "operator.dev@decisioning.local", label: "Operator", detail: "Ops actions in all environments" },
  { profile: "admin", email: "admin.dev@decisioning.local", label: "Admin", detail: "Full access in all environments" }
];

export default function LoginPage() {
  const [email, setEmail] = useState("builder.dev@decisioning.local");
  const [profile, setProfile] = useState<DevLoginProfile>("builder");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeEmail, setActiveEmail] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(USER_EMAIL_STORAGE_KEY);
      setActiveEmail(stored);
    } catch {
      setActiveEmail(null);
    }
  }, []);

  const activeProfileLabel = useMemo(() => {
    const preset = presets.find((item) => item.email === activeEmail);
    return preset?.label ?? null;
  }, [activeEmail]);

  const signIn = async (nextEmail: string, nextProfile: DevLoginProfile) => {
    setBusy(true);
    setError(null);
    try {
      setEnvironment("DEV");
      setApiUserEmail(nextEmail);
      await apiClient.auth.devLogin({
        email: nextEmail.trim().toLowerCase(),
        profile: nextProfile
      });
      window.location.href = "/overview";
    } catch (loginError) {
      setApiUserEmail(null);
      if (loginError instanceof ApiError) {
        setError(loginError.message);
      } else {
        setError(loginError instanceof Error ? loginError.message : "Login failed");
      }
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl space-y-4">
      <header className="panel space-y-2 p-4">
        <h2 className="text-xl font-semibold">Developer Login</h2>
        <p className="text-sm text-stone-600">
          Pick a preset role profile to test RBAC behavior quickly. This works in DEV environment only.
        </p>
        <p className="text-xs text-stone-500">
          Active user: {activeEmail ?? "none"}{activeProfileLabel ? ` (${activeProfileLabel})` : ""}
        </p>
      </header>

      <article className="panel grid gap-2 p-4 md:grid-cols-2">
        {presets.map((preset) => (
          <button
            key={preset.profile}
            type="button"
            className="rounded border border-stone-300 px-3 py-3 text-left hover:bg-stone-50 disabled:opacity-60"
            onClick={() => void signIn(preset.email, preset.profile)}
            disabled={busy}
          >
            <p className="font-medium">{preset.label}</p>
            <p className="text-xs text-stone-500">{preset.detail}</p>
            <p className="mt-1 text-xs text-stone-600">{preset.email}</p>
          </button>
        ))}
      </article>

      <article className="panel space-y-3 p-4">
        <h3 className="font-medium">Custom Email</h3>
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="min-w-[260px] rounded border border-stone-300 px-3 py-2 text-sm"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@company.com"
          />
          <select
            className="rounded border border-stone-300 px-3 py-2 text-sm"
            value={profile}
            onChange={(event) => setProfile(event.target.value as DevLoginProfile)}
          >
            <option value="viewer">viewer</option>
            <option value="builder">builder</option>
            <option value="publisher">publisher</option>
            <option value="operator">operator</option>
            <option value="admin">admin</option>
          </select>
          <button
            type="button"
            className="rounded bg-ink px-3 py-2 text-sm text-white disabled:opacity-60"
            onClick={() => void signIn(email, profile)}
            disabled={busy || !email.trim()}
          >
            Sign In
          </button>
          <button
            type="button"
            className="rounded border border-stone-300 px-3 py-2 text-sm"
            onClick={() => {
              setApiUserEmail(null);
              window.location.reload();
            }}
            disabled={busy}
          >
            Clear User
          </button>
          <Link className="rounded border border-stone-300 px-3 py-2 text-sm hover:bg-stone-100" href="/overview">
            Back to Overview
          </Link>
        </div>
        {error ? <p className="text-sm text-red-700">{error}</p> : null}
      </article>
    </section>
  );
}
