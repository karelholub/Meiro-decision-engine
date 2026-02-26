"use client";

export default function PermissionDenied({ title = "You don't have permission" }: { title?: string }) {
  return (
    <section className="panel mx-auto max-w-xl p-6 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="mt-2 text-sm text-stone-600">Your current role for this environment does not allow this action.</p>
    </section>
  );
}
