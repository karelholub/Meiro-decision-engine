import DecisionDetailsClient from "./details-client";

export default async function DecisionDetailsPage({
  params
}: {
  params: Promise<{ decisionId: string }>;
}) {
  const { decisionId } = await params;
  return <DecisionDetailsClient decisionId={decisionId} />;
}
