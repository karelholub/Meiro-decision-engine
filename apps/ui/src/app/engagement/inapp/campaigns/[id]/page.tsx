import { redirect } from "next/navigation";

export default async function LegacyCampaignEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/engage/campaigns/${encodeURIComponent(id)}/edit`);
}
