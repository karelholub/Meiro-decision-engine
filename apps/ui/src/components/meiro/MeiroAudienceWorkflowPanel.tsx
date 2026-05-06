"use client";

import Link from "next/link";
import { ButtonLink } from "../ui/button";
import { PagePanel } from "../ui/page";
import { normalizeMeiroAudienceRef, stripMeiroAudiencePrefix } from "../../lib/meiro-audience-context";
import { MeiroAudienceContextStrip } from "./MeiroAudienceContextStrip";

type AudienceWorkflowStep = "audiences" | "calendar" | "campaigns" | "control" | "simulate" | "precompute";

type MeiroAudienceWorkflowPanelProps = {
  audience: string;
  currentStep?: AudienceWorkflowStep;
  onClear?: () => void;
  className?: string;
  diagnosticsReason?: string | null;
};

const stepClassName = (active: boolean) =>
  `rounded-md border px-3 py-2 text-sm ${
    active ? "border-sky-300 bg-sky-50 text-sky-900" : "border-stone-200 bg-stone-50 text-stone-700"
  }`;

export function MeiroAudienceWorkflowPanel({ audience, currentStep, onClear, className = "", diagnosticsReason }: MeiroAudienceWorkflowPanelProps) {
  const normalizedAudience = normalizeMeiroAudienceRef(audience);
  const audienceKey = stripMeiroAudiencePrefix(normalizedAudience);
  const audienceParam = audienceKey ? `?audienceKey=${encodeURIComponent(audienceKey)}` : "";
  const fullAudienceParam = normalizedAudience ? `?audienceKey=${encodeURIComponent(normalizedAudience)}` : "";

  const hrefs = {
    audiences: `/engage/audiences${audienceParam}`,
    calendar: `/engage/calendar${fullAudienceParam}`,
    campaign: normalizedAudience
      ? `/engage/campaigns/new/edit?appKey=meiro_store&placementKey=home_top&audienceKey=${encodeURIComponent(normalizedAudience)}`
      : "/engage/campaigns/new/edit?appKey=meiro_store&placementKey=home_top",
    simulate: normalizedAudience ? `/simulate?audienceKey=${encodeURIComponent(normalizedAudience)}` : "/simulate",
    precompute: normalizedAudience ? `/execution/precompute?segment=${encodeURIComponent(normalizedAudience)}` : "/execution/precompute",
    diagnostics: "/engage/tools/meiro-diagnostics"
  };

  return (
    <PagePanel density="compact" className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-stone-900">Pipes audience workflow</p>
          <p className="mt-1 text-sm text-stone-700">
            {normalizedAudience
              ? "This page is using the selected Pipes audience for planning, activation, simulation, and precompute handoff."
              : "Select a Pipes audience to carry one segment through planning, activation, simulation, and precompute."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ButtonLink size="sm" variant="outline" href={hrefs.audiences}>
            Audiences
          </ButtonLink>
          <ButtonLink size="sm" href={hrefs.campaign}>
            Create campaign
          </ButtonLink>
        </div>
      </div>

      <MeiroAudienceContextStrip audience={normalizedAudience} onClear={onClear} />

      <div className="grid gap-2 md:grid-cols-5">
        <WorkflowLink active={currentStep === "audiences"} href={hrefs.audiences} label="Profiles" detail="Verify cache" />
        <WorkflowLink active={currentStep === "calendar"} href={hrefs.calendar} label="Calendar" detail="Plan pressure" />
        <WorkflowLink active={currentStep === "campaigns" || currentStep === "control"} href={hrefs.campaign} label="Create" detail="Campaign" />
        <WorkflowLink active={currentStep === "simulate"} href={hrefs.simulate} label="Simulate" detail="Decision fit" />
        <WorkflowLink active={currentStep === "precompute"} href={hrefs.precompute} label="Precompute" detail="Warm results" />
      </div>

      {diagnosticsReason ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <p>{diagnosticsReason}</p>
          <ButtonLink size="xs" variant="outline" href={hrefs.diagnostics}>
            Open diagnostics
          </ButtonLink>
        </div>
      ) : null}
    </PagePanel>
  );
}

function WorkflowLink({ active, href, label, detail }: { active: boolean; href: string; label: string; detail: string }) {
  return (
    <Link className={stepClassName(active)} href={href}>
      <span className="block font-medium">{label}</span>
      <span className="mt-0.5 block text-xs opacity-80">{detail}</span>
    </Link>
  );
}
