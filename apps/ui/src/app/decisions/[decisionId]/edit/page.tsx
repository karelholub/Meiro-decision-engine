import DecisionEditorClient from "../editor-client";

export default async function DecisionEditorPage({
  params,
  searchParams
}: {
  params: Promise<{ decisionId: string }>;
  searchParams?: Promise<{ tab?: string }>;
}) {
  const { decisionId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const candidateTab = resolvedSearchParams?.tab;
  const initialTab =
    candidateTab === "basic" || candidateTab === "advanced" || candidateTab === "report" ? candidateTab : "basic";

  return <DecisionEditorClient decisionId={decisionId} initialTab={initialTab} />;
}
