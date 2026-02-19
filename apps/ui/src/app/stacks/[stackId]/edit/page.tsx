import StackEditorClient from "../editor-client";

export default async function StackEditorPage({
  params,
  searchParams
}: {
  params: Promise<{ stackId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { stackId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const candidateTab = resolvedSearchParams?.tab;
  const initialTab = candidateTab === "basic" || candidateTab === "advanced" ? candidateTab : "basic";

  return <StackEditorClient stackId={stackId} initialTab={initialTab} />;
}
