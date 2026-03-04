import { redirect } from "next/navigation";

export default async function LegacyInAppCampaignReportPage({ params }: { params: Promise<{ campaignKey: string }> }) {
  const { campaignKey } = await params;
  redirect(`/engage/reports/${encodeURIComponent(campaignKey)}`);
}
