"use client";

import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import type {
  DecisionStackVersionSummary,
  DecisionVersionSummary,
  InAppCampaign,
  InAppPlacement,
  LogsQueryResponseItem
} from "@decisioning/shared";
import { InlineError } from "../../components/ui/app-state";
import { Button, ButtonLink } from "../../components/ui/button";
import {
  OperationalTableShell,
  operationalTableCellClassName,
  operationalTableClassName,
  operationalTableHeadClassName,
  operationalTableHeaderCellClassName
} from "../../components/ui/operational-table";
import { FieldLabel, FilterPanel, PageHeader, inputClassName } from "../../components/ui/page";
import { apiClient } from "../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../lib/environment";

const POLICY_PREFIXES = ["GLOBAL_", "MUTEX_", "COOLDOWN_", "ORCHESTRATION_"];
const isPolicyCode = (code: string): boolean => POLICY_PREFIXES.some((prefix) => code.startsWith(prefix));

export default function LogsPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [logType, setLogType] = useState<"decision" | "stack" | "inapp">("decision");
  const [decisionId, setDecisionId] = useState("");
  const [stackKey, setStackKey] = useState("");
  const [campaignKey, setCampaignKey] = useState("");
  const [placement, setPlacement] = useState("");
  const [profileId, setProfileId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [decisionOptions, setDecisionOptions] = useState<DecisionVersionSummary[]>([]);
  const [stackOptions, setStackOptions] = useState<DecisionStackVersionSummary[]>([]);
  const [campaignOptions, setCampaignOptions] = useState<InAppCampaign[]>([]);
  const [placementOptions, setPlacementOptions] = useState<InAppPlacement[]>([]);
  const [items, setItems] = useState<LogsQueryResponseItem[]>([]);
  const [expanded, setExpanded] = useState<
    Record<
      string,
      {
        trace?: unknown;
        payload?: unknown;
        policy?: LogsQueryResponseItem["policy"];
        actionDescriptor?: unknown;
      }
    >
  >({});
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  useEffect(() => {
    const loadFilterOptions = async () => {
      try {
        const [decisionResponse, stackResponse, campaignResponse, placementResponse] = await Promise.all([
          apiClient.decisions.list({ status: "ACTIVE", page: 1, limit: 100 }),
          apiClient.stacks.list({ status: "ACTIVE", page: 1, limit: 100 }),
          apiClient.inapp.campaigns.list(),
          apiClient.inapp.placements.list()
        ]);
        setDecisionOptions(decisionResponse.items);
        setStackOptions(stackResponse.items);
        setCampaignOptions(campaignResponse.items);
        setPlacementOptions(placementResponse.items);
      } catch {
        // filter options are best effort
      }
    };
    void loadFilterOptions();
  }, [environment]);

  useEffect(() => {
    if (decisionId && !decisionOptions.some((item) => item.decisionId === decisionId)) {
      setDecisionId("");
    }
  }, [decisionId, decisionOptions]);

  useEffect(() => {
    if (stackKey && !stackOptions.some((item) => item.key === stackKey)) {
      setStackKey("");
    }
  }, [stackKey, stackOptions]);

  useEffect(() => {
    if (campaignKey && !campaignOptions.some((item) => item.key === campaignKey)) {
      setCampaignKey("");
    }
  }, [campaignKey, campaignOptions]);

  useEffect(() => {
    if (placement && !placementOptions.some((item) => item.key === placement)) {
      setPlacement("");
    }
  }, [placement, placementOptions]);

  const load = async () => {
    setLoading(true);
    try {
      const response = await apiClient.logs.list({
        type: logType,
        decisionId: logType === "decision" ? decisionId || undefined : undefined,
        stackKey: logType === "stack" ? stackKey || undefined : undefined,
        campaignKey: logType === "inapp" ? campaignKey || undefined : undefined,
        placement: logType === "inapp" ? placement || undefined : undefined,
        profileId: profileId || undefined,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(to).toISOString() : undefined,
        page,
        limit: 50
      });
      setItems(response.items);
      setTotalPages(response.totalPages);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [page, environment, logType]);

  const toggleExpand = async (id: string) => {
    if (expanded[id]) {
      setExpanded((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      return;
    }

    try {
      const response = await apiClient.logs.get(id, true, logType);
      setExpanded((current) => ({
        ...current,
        [id]: {
          trace: response.item?.trace,
          payload: response.item?.payload,
          policy: response.item?.policy ?? null,
          actionDescriptor: response.item?.actionDescriptor ?? null
        }
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load log details");
    }
  };

  return (
    <section className="space-y-4">
      <PageHeader
        density="compact"
        title="Logs"
        description={`Decision and in-app logs with replay support. Environment: ${environment}.`}
      />

      <FilterPanel density="compact" className="grid gap-x-2 gap-y-2 md:grid-cols-2 lg:grid-cols-6">
        <FieldLabel className="flex flex-col gap-1">
          Type
          <select
            value={logType}
            onChange={(event) => {
              setLogType(event.target.value as "decision" | "stack" | "inapp");
              setPage(1);
            }}
            className={inputClassName}
          >
            <option value="decision">decision</option>
            <option value="stack">stack</option>
            <option value="inapp">inapp</option>
          </select>
        </FieldLabel>

        {logType === "decision" ? (
          <FieldLabel className="flex flex-col gap-1 lg:col-span-2">
            Decision ID
            <select
              value={decisionId}
              onChange={(event) => setDecisionId(event.target.value)}
              className={inputClassName}
            >
              <option value="">All active decisions</option>
              {decisionOptions.map((item) => (
                <option key={item.versionId} value={item.decisionId}>
                  {item.key} ({item.name})
                </option>
              ))}
            </select>
          </FieldLabel>
        ) : logType === "stack" ? (
          <FieldLabel className="flex flex-col gap-1 lg:col-span-2">
            Stack key
            <select
              value={stackKey}
              onChange={(event) => setStackKey(event.target.value)}
              className={inputClassName}
            >
              <option value="">All active stacks</option>
              {stackOptions.map((item) => (
                <option key={`${item.stackId}:${item.version}`} value={item.key}>
                  {item.key} ({item.name})
                </option>
              ))}
            </select>
          </FieldLabel>
        ) : (
          <>
            <FieldLabel className="flex flex-col gap-1">
              Campaign Key
              <select
                value={campaignKey}
                onChange={(event) => setCampaignKey(event.target.value)}
                className={inputClassName}
              >
                <option value="">All campaigns</option>
                {campaignOptions.map((item) => (
                  <option key={item.id} value={item.key}>
                    {item.key}
                  </option>
                ))}
              </select>
            </FieldLabel>
            <FieldLabel className="flex flex-col gap-1">
              Placement
              <select
                value={placement}
                onChange={(event) => setPlacement(event.target.value)}
                className={inputClassName}
              >
                <option value="">All placements</option>
                {placementOptions.map((item) => (
                  <option key={item.id} value={item.key}>
                    {item.key}
                  </option>
                ))}
              </select>
            </FieldLabel>
          </>
        )}

        <FieldLabel className="flex flex-col gap-1">
          Profile ID
          <input
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          From
          <input
            type="datetime-local"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          To
          <input
            type="datetime-local"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className={inputClassName}
          />
        </FieldLabel>
      </FilterPanel>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            setPage(1);
            void load();
          }}
          disabled={loading}
        >
          {loading ? "Loading..." : "Apply Filters"}
        </Button>
      </div>

      {error ? <InlineError title="Logs unavailable" description={error} /> : null}

      <OperationalTableShell tableMinWidth="1180px">
        <table className={operationalTableClassName}>
          <thead className={operationalTableHeadClassName}>
            <tr>
              <th className={operationalTableHeaderCellClassName}>Time</th>
              <th className={operationalTableHeaderCellClassName}>
                {logType === "decision" ? "Decision" : logType === "stack" ? "Stack" : "Campaign"}
              </th>
              <th className={operationalTableHeaderCellClassName}>Profile</th>
              <th className={operationalTableHeaderCellClassName}>Outcome</th>
              <th className={operationalTableHeaderCellClassName}>Action</th>
              <th className={operationalTableHeaderCellClassName}>Reasons</th>
              <th className={operationalTableHeaderCellClassName}>Policy</th>
              <th className={operationalTableHeaderCellClassName}>Latency</th>
              <th className={operationalTableHeaderCellClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <Fragment key={item.id}>
                <tr key={item.id}>
                  <td className={operationalTableCellClassName}>{new Date(item.timestamp).toLocaleString()}</td>
                  <td className={operationalTableCellClassName}>{item.stackKey ?? item.decisionId}</td>
                  <td className={operationalTableCellClassName}>{item.profileId}</td>
                  <td className={operationalTableCellClassName}>{item.outcome}</td>
                  <td className={operationalTableCellClassName}>{item.actionType}</td>
                  <td className={operationalTableCellClassName}>{item.reasons.map((reason) => reason.code).join(", ")}</td>
                  <td className={operationalTableCellClassName}>
                    {item.policy ? (
                      item.policy.allowed ? (
                        "Allowed"
                      ) : (
                        <>
                          Blocked
                          {item.policy.blockingRule
                            ? `: ${item.policy.blockingRule.policyKey}/${item.policy.blockingRule.ruleId}`
                            : ""}
                        </>
                      )
                    ) : (
                      item.reasons
                        .map((reason) => reason.code)
                        .filter((code) => isPolicyCode(code))
                        .join(", ") || "none"
                    )}
                  </td>
                  <td className={operationalTableCellClassName}>{item.latencyMs}ms</td>
                  <td className={operationalTableCellClassName}>
                    <div className="flex gap-2">
                      <Button size="xs" variant="outline" onClick={() => void toggleExpand(item.id)}>
                        {expanded[item.id] ? "Hide" : "Expand"}
                      </Button>
                      {item.replayAvailable ? (
                        <ButtonLink size="xs" href={`/simulate?logId=${item.id}&logType=${logType}`}>
                          Replay
                        </ButtonLink>
                      ) : null}
                    </div>
                  </td>
                </tr>
                {expanded[item.id] ? (
                  <tr key={`${item.id}-expanded`}>
                    <td colSpan={9} className="border-b border-stone-100 bg-stone-50 px-3 py-2">
                      <div className="grid gap-3 md:grid-cols-3">
                        <div>
                          <p className="mb-1 text-xs font-semibold">Payload</p>
                          <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                            {JSON.stringify(expanded[item.id]?.payload ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 text-xs font-semibold">Trace</p>
                          <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                            {JSON.stringify(expanded[item.id]?.trace ?? {}, null, 2)}
                          </pre>
                        </div>
                        <div className="space-y-2">
                          <div>
                            <p className="mb-1 text-xs font-semibold">Policy</p>
                            <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                              {JSON.stringify(expanded[item.id]?.policy ?? null, null, 2)}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 text-xs font-semibold">Action Descriptor</p>
                            <pre className="overflow-auto rounded-md border border-stone-200 bg-white p-2 text-xs">
                              {JSON.stringify(expanded[item.id]?.actionDescriptor ?? null, null, 2)}
                            </pre>
                          </div>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
          </tbody>
        </table>
      </OperationalTableShell>

      <div className="flex items-center justify-between text-sm">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPage((value) => Math.max(1, value - 1))}
          disabled={page <= 1}
        >
          Previous
        </Button>
        <p>
          Page {page} / {Math.max(1, totalPages)}
        </p>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
          disabled={page >= totalPages}
        >
          Next
        </Button>
      </div>
    </section>
  );
}
