"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { WbsMappingJson, WbsMappingSettings, WbsProfileIdStrategy } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";
import { Button } from "../../../components/ui/button";
import { RedactedJsonViewer, summarizeMappingWarnings } from "../../../components/configure";

interface MappingValidateResponse {
  valid: boolean;
  errors: string[];
  warnings: string[];
  formatted?: string | null;
}

type AttributeTransform = "takeFirst" | "takeAll" | "parseJsonIfString" | "coerceNumber" | "coerceDate";
type AudienceTransform = "takeFirst" | "takeAll" | "parseJsonIfString" | "coerceNumber";
type AudienceOp = "exists" | "eq" | "contains" | "in" | "gte" | "lte";

interface AttributeMappingRow {
  sourceKey: string;
  targetKey: string;
  transform: AttributeTransform;
  defaultValue: string;
}

interface AudienceRuleRow {
  id: string;
  audienceKey: string;
  sourceKey: string;
  op: AudienceOp;
  value: string;
  transform: AudienceTransform;
}

const createEmptyAttributeMapping = (): AttributeMappingRow => ({
  sourceKey: "",
  targetKey: "",
  transform: "takeFirst",
  defaultValue: ""
});

const createEmptyAudienceRule = (): AudienceRuleRow => ({
  id: `rule-${Math.random().toString(36).slice(2, 8)}`,
  audienceKey: "",
  sourceKey: "",
  op: "exists",
  value: "",
  transform: "takeFirst"
});

const TRANSFORM_HINTS: Record<AttributeTransform | AudienceTransform, string> = {
  takeFirst: "Example: ['9500'] -> '9500'",
  takeAll: "Example: ['A','B'] -> ['A','B']",
  parseJsonIfString: "Example: '{\"x\":1}' -> {x:1}",
  coerceNumber: "Example: '42' -> 42",
  coerceDate: "Example: '2024-01-01' -> ISO date"
};

const parseLooseValue = (value: string): unknown => {
  if (!value.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

const toCommaList = (value: string): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

const pickFromProfile = (profile: Record<string, unknown>, sourceKey: string): unknown => {
  const attributes = profile.attributes && typeof profile.attributes === "object" && !Array.isArray(profile.attributes)
    ? (profile.attributes as Record<string, unknown>)
    : {};

  if (sourceKey in attributes) {
    return attributes[sourceKey];
  }
  return profile[sourceKey];
};

const evaluateRuleAgainstProfile = (rule: AudienceRuleRow, profile: Record<string, unknown>) => {
  const actual = pickFromProfile(profile, rule.sourceKey);
  const expected = parseLooseValue(rule.value);

  switch (rule.op) {
    case "exists":
      return actual !== undefined && actual !== null;
    case "eq":
      return actual === expected;
    case "contains":
      return Array.isArray(actual) ? actual.includes(expected) : String(actual ?? "").includes(String(expected ?? ""));
    case "in":
      return Array.isArray(expected) ? expected.includes(actual) : false;
    case "gte":
      return Number(actual) >= Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    default:
      return false;
  }
};

export default function WbsMappingPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [tab, setTab] = useState<"mapping" | "advanced">("mapping");
  const [name, setName] = useState("Default WBS Mapping");
  const [profileIdStrategy, setProfileIdStrategy] = useState<WbsProfileIdStrategy>("CUSTOMER_ENTITY_ID");
  const [profileIdAttributeKey, setProfileIdAttributeKey] = useState("");
  const [attributeMappings, setAttributeMappings] = useState<AttributeMappingRow[]>([createEmptyAttributeMapping()]);
  const [audienceRules, setAudienceRules] = useState<AudienceRuleRow[]>([createEmptyAudienceRule()]);
  const [consentEnabled, setConsentEnabled] = useState(false);
  const [consentSourceKey, setConsentSourceKey] = useState("");
  const [consentYesValues, setConsentYesValues] = useState("yes");
  const [consentNoValues, setConsentNoValues] = useState("no");
  const [jsonDraft, setJsonDraft] = useState("{}");
  const [validation, setValidation] = useState<MappingValidateResponse | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  const [testLookupAttribute, setTestLookupAttribute] = useState("email");
  const [testLookupValue, setTestLookupValue] = useState("demo@example.com");
  const [testRawResponseJson, setTestRawResponseJson] = useState(`{\n  "status": "ok",\n  "customer_entity_id": "cust-demo-1",\n  "returned_attributes": {\n    "web_rfm": ["Lost"],\n    "web_total_spend": ["9500"],\n    "cookie_consent_status": ["yes"]\n  }\n}`);

  const [lastTestedAt, setLastTestedAt] = useState<string | null>(null);
  const [lastTestRaw, setLastTestRaw] = useState<unknown | null>(null);
  const [lastTestProfile, setLastTestProfile] = useState<unknown | null>(null);
  const [lastTestSummary, setLastTestSummary] = useState<unknown | null>(null);
  const [audienceRuleTestById, setAudienceRuleTestById] = useState<Record<string, boolean | null>>({});

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const toMappingFromBasic = (): WbsMappingJson => {
    const mapping: WbsMappingJson = {
      attributeMappings: attributeMappings
        .filter((row) => row.sourceKey.trim() && row.targetKey.trim())
        .map((row) => ({
          sourceKey: row.sourceKey.trim(),
          targetKey: row.targetKey.trim(),
          transform: row.transform,
          defaultValue: parseLooseValue(row.defaultValue)
        })),
      audienceRules: audienceRules
        .filter((row) => row.audienceKey.trim() && row.sourceKey.trim())
        .map((row) => ({
          id: row.id,
          audienceKey: row.audienceKey.trim(),
          when: {
            sourceKey: row.sourceKey.trim(),
            op: row.op,
            value: row.op === "exists" ? undefined : parseLooseValue(row.value)
          },
          transform: row.transform
        }))
    };

    if (consentEnabled && consentSourceKey.trim()) {
      mapping.consentMapping = {
        sourceKey: consentSourceKey.trim(),
        transform: "takeFirst",
        yesValues: toCommaList(consentYesValues),
        noValues: toCommaList(consentNoValues)
      };
    }

    return mapping;
  };

  const hydrate = (item: WbsMappingSettings | null) => {
    if (!item) {
      return;
    }

    setName(item.name);
    setProfileIdStrategy(item.profileIdStrategy);
    setProfileIdAttributeKey(item.profileIdAttributeKey ?? "");
    setUpdatedAt(item.updatedAt);

    setAttributeMappings(
      item.mappingJson.attributeMappings.length > 0
        ? item.mappingJson.attributeMappings.map((entry) => ({
            sourceKey: entry.sourceKey,
            targetKey: entry.targetKey,
            transform: entry.transform ?? "takeFirst",
            defaultValue: entry.defaultValue === undefined ? "" : JSON.stringify(entry.defaultValue)
          }))
        : [createEmptyAttributeMapping()]
    );

    setAudienceRules(
      item.mappingJson.audienceRules.length > 0
        ? item.mappingJson.audienceRules.map((entry) => ({
            id: entry.id,
            audienceKey: entry.audienceKey,
            sourceKey: entry.when.sourceKey,
            op: entry.when.op,
            value: entry.when.value === undefined ? "" : JSON.stringify(entry.when.value),
            transform: entry.transform ?? "takeFirst"
          }))
        : [createEmptyAudienceRule()]
    );

    if (item.mappingJson.consentMapping) {
      setConsentEnabled(true);
      setConsentSourceKey(item.mappingJson.consentMapping.sourceKey);
      setConsentYesValues(item.mappingJson.consentMapping.yesValues.join(","));
      setConsentNoValues(item.mappingJson.consentMapping.noValues.join(","));
    } else {
      setConsentEnabled(false);
      setConsentSourceKey("");
      setConsentYesValues("yes");
      setConsentNoValues("no");
    }

    setJsonDraft(JSON.stringify(item.mappingJson, null, 2));
  };

  const load = async () => {
    try {
      const response = await apiClient.settings.getWbsMapping();
      hydrate(response.item);
      setFeedback(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to load mapping");
    }
  };

  useEffect(() => {
    void load();
  }, [environment]);

  const save = async () => {
    try {
      const mappingJson = tab === "mapping" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
      const response = await apiClient.settings.saveWbsMapping({
        name,
        profileIdStrategy,
        profileIdAttributeKey: profileIdStrategy === "ATTRIBUTE_KEY" ? profileIdAttributeKey || null : null,
        mappingJson
      });
      hydrate(response.item);
      setFeedback("WBS mapping saved.");
      setValidation(null);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Failed to save mapping");
    }
  };

  const validate = async () => {
    try {
      const mappingJson = tab === "mapping" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
      const response = await apiClient.settings.validateWbsMapping(mappingJson);
      setValidation(response);
      if (response.formatted && tab === "advanced") {
        setJsonDraft(response.formatted);
      }
      setFeedback(response.valid ? "Mapping validation passed." : "Mapping validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
    }
  };

  const testMapping = async () => {
    try {
      const mappingJson = tab === "mapping" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
      const rawResponse = JSON.parse(testRawResponseJson) as Record<string, unknown>;
      const response = await apiClient.settings.testWbsMapping({
        lookup: {
          attribute: testLookupAttribute,
          value: testLookupValue
        },
        rawResponse,
        profileIdStrategy,
        profileIdAttributeKey: profileIdStrategy === "ATTRIBUTE_KEY" ? profileIdAttributeKey || null : null,
        mappingJson
      });
      setLastTestedAt(new Date().toISOString());
      setLastTestRaw(rawResponse);
      setLastTestProfile(response.profile);
      setLastTestSummary(response.summary);
      setFeedback("Mapping test succeeded.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Mapping test failed");
    }
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(jsonDraft);
      setJsonDraft(`${JSON.stringify(parsed, null, 2)}\n`);
    } catch {
      setFeedback("JSON is invalid.");
    }
  };

  const warningSummary = summarizeMappingWarnings(lastTestSummary);

  const consentPreview = useMemo(() => {
    if (!lastTestProfile || typeof lastTestProfile !== "object" || Array.isArray(lastTestProfile)) {
      return "Not available";
    }
    const profile = lastTestProfile as Record<string, unknown>;
    if (Array.isArray(profile.consents) && profile.consents.some((entry) => String(entry) === "consent_marketing")) {
      return "consent_marketing=true";
    }
    const attributes = profile.attributes && typeof profile.attributes === "object" && !Array.isArray(profile.attributes)
      ? (profile.attributes as Record<string, unknown>)
      : {};
    if (typeof attributes.consent_marketing === "boolean") {
      return `consent_marketing=${String(attributes.consent_marketing)}`;
    }
    return "Not available";
  }, [lastTestProfile]);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">WBS Mapping</h2>
        <p className="text-sm text-stone-700">Map WBS returned_attributes into profile attributes, audiences, and consents ({environment}).</p>
        {updatedAt ? <p className="text-xs text-stone-600">Last updated: {new Date(updatedAt).toLocaleString()}</p> : null}
      </header>

      <section className="panel space-y-2 p-4">
        <h3 className="font-semibold">Mapping health</h3>
        <p className="text-sm">Last tested: {lastTestedAt ? new Date(lastTestedAt).toLocaleString() : "Not available yet"}</p>
        <p className="text-sm">Missing fields: {warningSummary.missingFields} | Type mismatches: {warningSummary.typeIssues}</p>
        <Link className="text-sm underline" href="/overview">Open Observability for mapping</Link>
      </section>

      <div className="panel flex flex-wrap items-center gap-2 p-4 text-sm">
        <button className={`rounded-md border px-3 py-1 ${tab === "mapping" ? "bg-ink text-white" : "border-stone-300"}`} onClick={() => setTab("mapping")}>Mapping Table</button>
        <button className={`rounded-md border px-3 py-1 ${tab === "advanced" ? "bg-ink text-white" : "border-stone-300"}`} onClick={() => setTab("advanced")}>Advanced JSON</button>
        <Button onClick={() => void save()}>Save</Button>
        <Button variant="outline" onClick={() => void validate()}>Validate</Button>
        <Button variant="outline" onClick={() => void testMapping()}>Test mapping</Button>
      </div>

      {tab === "mapping" ? (
        <div className="space-y-4">
          <div className="panel grid gap-3 p-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Mapping name
              <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Profile ID strategy
              <select value={profileIdStrategy} onChange={(event) => setProfileIdStrategy(event.target.value as WbsProfileIdStrategy)} className="rounded-md border border-stone-300 px-2 py-1">
                <option value="CUSTOMER_ENTITY_ID">customer_entity_id</option>
                <option value="ATTRIBUTE_KEY">returned attribute key</option>
                <option value="HASH_FALLBACK">hash fallback</option>
              </select>
            </label>

            {profileIdStrategy === "ATTRIBUTE_KEY" ? (
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                Profile ID attribute key
                <input value={profileIdAttributeKey} onChange={(event) => setProfileIdAttributeKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
              </label>
            ) : null}
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Attribute mappings</h3>
              <Button variant="outline" size="sm" onClick={() => setAttributeMappings((prev) => [...prev, createEmptyAttributeMapping()])}>Add row</Button>
            </div>
            <div className="grid gap-2 text-xs font-semibold text-stone-600 md:grid-cols-5">
              <p>Source attribute (WBS)</p>
              <p>Target field (Decision profile)</p>
              <p>Transform</p>
              <p>Default (JSON)</p>
              <p />
            </div>
            <div className="space-y-3">
              {attributeMappings.map((row, index) => (
                <div key={`attr-${index}`} className="grid gap-2 md:grid-cols-5">
                  <input placeholder="sourceKey" value={row.sourceKey} onChange={(event) => setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, sourceKey: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                  <input placeholder="targetKey" value={row.targetKey} onChange={(event) => setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, targetKey: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                  <div>
                    <select value={row.transform} onChange={(event) => setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, transform: event.target.value as AttributeTransform } : entry)))} className="w-full rounded-md border border-stone-300 px-2 py-1 text-sm">
                      <option value="takeFirst">takeFirst</option>
                      <option value="takeAll">takeAll</option>
                      <option value="parseJsonIfString">parseJsonIfString</option>
                      <option value="coerceNumber">coerceNumber</option>
                      <option value="coerceDate">coerceDate</option>
                    </select>
                    <p className="mt-1 text-xs text-stone-500">{TRANSFORM_HINTS[row.transform]}</p>
                  </div>
                  <input placeholder="defaultValue" value={row.defaultValue} onChange={(event) => setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, defaultValue: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                  <Button variant="ghost" size="sm" onClick={() => setAttributeMappings((prev) => prev.filter((_, idx) => idx !== index))}>Remove</Button>
                </div>
              ))}
            </div>
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Audience rules</h3>
              <Button variant="outline" size="sm" onClick={() => setAudienceRules((prev) => [...prev, createEmptyAudienceRule()])}>Add rule</Button>
            </div>
            <div className="space-y-3">
              {audienceRules.map((row, index) => (
                <div key={row.id} className="rounded-md border border-stone-200 p-3">
                  <div className="grid gap-2 md:grid-cols-7">
                    <input placeholder="audienceKey" value={row.audienceKey} onChange={(event) => setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, audienceKey: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                    <input placeholder="sourceKey" value={row.sourceKey} onChange={(event) => setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, sourceKey: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                    <select value={row.op} onChange={(event) => setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, op: event.target.value as AudienceOp } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm">
                      <option value="exists">exists</option>
                      <option value="eq">eq</option>
                      <option value="contains">contains</option>
                      <option value="in">in</option>
                      <option value="gte">gte</option>
                      <option value="lte">lte</option>
                    </select>
                    <input placeholder="value (JSON)" value={row.value} onChange={(event) => setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, value: event.target.value } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                    <select value={row.transform} onChange={(event) => setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, transform: event.target.value as AudienceTransform } : entry)))} className="rounded-md border border-stone-300 px-2 py-1 text-sm">
                      <option value="takeFirst">takeFirst</option>
                      <option value="takeAll">takeAll</option>
                      <option value="parseJsonIfString">parseJsonIfString</option>
                      <option value="coerceNumber">coerceNumber</option>
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        if (!lastTestProfile || typeof lastTestProfile !== "object" || Array.isArray(lastTestProfile)) {
                          setAudienceRuleTestById((current) => ({ ...current, [row.id]: null }));
                          return;
                        }
                        const result = evaluateRuleAgainstProfile(row, lastTestProfile as Record<string, unknown>);
                        setAudienceRuleTestById((current) => ({ ...current, [row.id]: result }));
                      }}
                    >
                      Test
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAudienceRules((prev) => prev.filter((_, idx) => idx !== index))}>Remove</Button>
                  </div>
                  <p className="mt-1 text-xs text-stone-500">{TRANSFORM_HINTS[row.transform]}</p>
                  {row.id in audienceRuleTestById ? (
                    <p className={`mt-1 text-xs ${audienceRuleTestById[row.id] ? "text-emerald-700" : audienceRuleTestById[row.id] === false ? "text-red-700" : "text-stone-600"}`}>
                      {audienceRuleTestById[row.id] === null
                        ? "Run mapping test first to get sample mapped profile."
                        : audienceRuleTestById[row.id]
                          ? "Rule matched sample mapped profile"
                          : "Rule did not match sample mapped profile"}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          </div>

          <div className="panel space-y-3 p-4">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={consentEnabled} onChange={(event) => setConsentEnabled(event.target.checked)} />
              Enable consent mapping
            </label>
            {consentEnabled ? (
              <div className="grid gap-3 md:grid-cols-3">
                <input placeholder="sourceKey" value={consentSourceKey} onChange={(event) => setConsentSourceKey(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                <input placeholder="yesValues (comma)" value={consentYesValues} onChange={(event) => setConsentYesValues(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
                <input placeholder="noValues (comma)" value={consentNoValues} onChange={(event) => setConsentNoValues(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1 text-sm" />
              </div>
            ) : null}
            <p className="text-xs text-stone-600">Consent preview: {consentPreview}</p>
          </div>

          <div className="panel grid gap-3 p-4 md:grid-cols-3">
            <label className="flex flex-col gap-1 text-sm">
              Test lookup attribute
              <input value={testLookupAttribute} onChange={(event) => setTestLookupAttribute(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Test lookup value
              <input value={testLookupValue} onChange={(event) => setTestLookupValue(event.target.value)} className="rounded-md border border-stone-300 px-2 py-1" />
            </label>
            <label className="flex flex-col gap-1 text-sm md:col-span-3">
              Raw WBS response (for test mapping)
              <textarea value={testRawResponseJson} onChange={(event) => setTestRawResponseJson(event.target.value)} className="min-h-28 rounded-md border border-stone-300 px-2 py-1 font-mono text-xs" />
            </label>
          </div>
        </div>
      ) : (
        <div className="panel space-y-3 p-4">
          <div className="flex gap-2">
            <Button variant="outline" onClick={formatJson}>Format JSON</Button>
            <Button variant="outline" onClick={() => void validate()}>Validate</Button>
          </div>
          <textarea value={jsonDraft} onChange={(event) => setJsonDraft(event.target.value)} className="min-h-[28rem] w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm" />
        </div>
      )}

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}

      {lastTestRaw || lastTestProfile || lastTestSummary ? (
        <section className="panel space-y-3 p-4">
          <h3 className="font-semibold">Test Mapping Output</h3>
          <div className="grid gap-3 lg:grid-cols-3">
            <RedactedJsonViewer title="Raw WBS response" value={lastTestRaw} maxChars={2048} defaultOpen />
            <RedactedJsonViewer title="Mapped profile" value={lastTestProfile} maxChars={3000} defaultOpen />
            <RedactedJsonViewer title="Warnings" value={{ warnings: warningSummary.warnings, missingFields: warningSummary.missingFields, typeIssues: warningSummary.typeIssues }} maxChars={2500} defaultOpen />
          </div>
        </section>
      ) : null}

      {validation ? (
        <section className="panel space-y-2 p-4 text-sm">
          <h3 className="font-semibold">Validation</h3>
          <div>
            <h4 className="font-medium">Errors</h4>
            {validation.errors.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          </div>
          <div>
            <h4 className="font-medium">Warnings</h4>
            {validation.warnings.length === 0 ? <p>None</p> : null}
            <ul className="list-disc pl-5">
              {validation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        </section>
      ) : null}
    </section>
  );
}
