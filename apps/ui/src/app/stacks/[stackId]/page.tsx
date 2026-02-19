import StackDetailsClient from "./details-client";

export default async function StackDetailsPage({
  params
}: {
  params: Promise<{ stackId: string }>;
}) {
  const { stackId } = await params;
  return <StackDetailsClient stackId={stackId} />;
}
