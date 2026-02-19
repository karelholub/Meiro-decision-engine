import DecisionEditorClient from "./editor-client";

export default async function DecisionEditorPage({
  params
}: {
  params: Promise<{ decisionId: string }>;
}) {
  const { decisionId } = await params;
  return <DecisionEditorClient decisionId={decisionId} />;
}
