"use client";

import { useEffect, useState } from "react";
import type { WbsMappingJson, WbsMappingSettings, WbsProfileIdStrategy } from "@decisioning/shared";
import { apiClient } from "../../../lib/api";
import { getEnvironment, onEnvironmentChange, type UiEnvironment } from "../../../lib/environment";

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

export default function WbsMappingPage() {
  const [environment, setEnvironment] = useState<UiEnvironment>("DEV");
  const [tab, setTab] = useState<"basic" | "json">("basic");
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
  const [testMappingOutput, setTestMappingOutput] = useState<string | null>(null);

  useEffect(() => {
    setEnvironment(getEnvironment());
    return onEnvironmentChange(setEnvironment);
  }, []);

  const toCommaList = (value: string): string[] => {
    return value
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
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
      const mappingJson = tab === "basic" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
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
      const mappingJson = tab === "basic" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
      const response = await apiClient.settings.validateWbsMapping(mappingJson);
      setValidation(response);
      if (response.formatted && tab === "json") {
        setJsonDraft(response.formatted);
      }
      setFeedback(response.valid ? "Mapping validation passed." : "Mapping validation failed.");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Validation failed");
    }
  };

  const testMapping = async () => {
    try {
      const mappingJson = tab === "basic" ? toMappingFromBasic() : (JSON.parse(jsonDraft) as WbsMappingJson);
      const response = await apiClient.settings.testWbsMapping({
        lookup: {
          attribute: "email",
          value: "demo@example.com"
        },
        rawResponse: {
          status: "ok",
          customer_entity_id: "cust-demo-1",
          returned_attributes: {
            web_rfm: ["Lost"],
            web_total_spend: ["9500"],
            cookie_consent_status: ["yes"]
          }
        },
        profileIdStrategy,
        profileIdAttributeKey: profileIdStrategy === "ATTRIBUTE_KEY" ? profileIdAttributeKey || null : null,
        mappingJson
      });
      setTestMappingOutput(JSON.stringify(response, null, 2));
      setFeedback("Mapping test succeeded.");
    } catch (error) {
      setTestMappingOutput(null);
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

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">WBS Mapping</h2>
        <p className="text-sm text-stone-700">
          Map WBS returned_attributes into profile attributes, audiences, and consents ({environment}).
        </p>
        {updatedAt ? <p className="text-xs text-stone-600">Last updated: {new Date(updatedAt).toLocaleString()}</p> : null}
      </header>

      <div className="panel flex flex-wrap gap-2 p-4 text-sm">
        <button
          className={`rounded-md border px-3 py-1 ${tab === "basic" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => setTab("basic")}
        >
          Basic
        </button>
        <button
          className={`rounded-md border px-3 py-1 ${tab === "json" ? "bg-ink text-white" : "border-stone-300"}`}
          onClick={() => setTab("json")}
        >
          JSON
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void save()}>
          Save
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void validate()}>
          Validate
        </button>
        <button className="rounded-md border border-stone-300 px-3 py-1" onClick={() => void testMapping()}>
          Test Mapping
        </button>
      </div>

      {tab === "basic" ? (
        <div className="space-y-4">
          <div className="panel grid gap-3 p-4 md:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              Mapping name
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="rounded-md border border-stone-300 px-2 py-1"
              />
            </label>

            <label className="flex flex-col gap-1 text-sm">
              Profile ID strategy
              <select
                value={profileIdStrategy}
                onChange={(event) => setProfileIdStrategy(event.target.value as WbsProfileIdStrategy)}
                className="rounded-md border border-stone-300 px-2 py-1"
              >
                <option value="CUSTOMER_ENTITY_ID">customer_entity_id</option>
                <option value="ATTRIBUTE_KEY">returned attribute key</option>
                <option value="HASH_FALLBACK">hash fallback</option>
              </select>
            </label>

            {profileIdStrategy === "ATTRIBUTE_KEY" ? (
              <label className="flex flex-col gap-1 text-sm md:col-span-2">
                Profile ID attribute key
                <input
                  value={profileIdAttributeKey}
                  onChange={(event) => setProfileIdAttributeKey(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1"
                />
              </label>
            ) : null}
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Attribute mappings</h3>
              <button
                className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                onClick={() => setAttributeMappings((prev) => [...prev, createEmptyAttributeMapping()])}
              >
                Add row
              </button>
            </div>
            <div className="space-y-3">
              {attributeMappings.map((row, index) => (
                <div key={`attr-${index}`} className="grid gap-2 md:grid-cols-4">
                  <input
                    placeholder="sourceKey"
                    value={row.sourceKey}
                    onChange={(event) =>
                      setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, sourceKey: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <input
                    placeholder="targetKey"
                    value={row.targetKey}
                    onChange={(event) =>
                      setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, targetKey: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <select
                    value={row.transform}
                    onChange={(event) =>
                      setAttributeMappings((prev) =>
                        prev.map((entry, idx) =>
                          idx === index ? { ...entry, transform: event.target.value as AttributeTransform } : entry
                        )
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  >
                    <option value="takeFirst">takeFirst</option>
                    <option value="takeAll">takeAll</option>
                    <option value="parseJsonIfString">parseJsonIfString</option>
                    <option value="coerceNumber">coerceNumber</option>
                    <option value="coerceDate">coerceDate</option>
                  </select>
                  <input
                    placeholder="defaultValue (JSON)"
                    value={row.defaultValue}
                    onChange={(event) =>
                      setAttributeMappings((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, defaultValue: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="panel space-y-3 p-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Audience rules</h3>
              <button
                className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                onClick={() => setAudienceRules((prev) => [...prev, createEmptyAudienceRule()])}
              >
                Add rule
              </button>
            </div>
            <div className="space-y-3">
              {audienceRules.map((row, index) => (
                <div key={row.id} className="grid gap-2 md:grid-cols-6">
                  <input
                    placeholder="audienceKey"
                    value={row.audienceKey}
                    onChange={(event) =>
                      setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, audienceKey: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <input
                    placeholder="sourceKey"
                    value={row.sourceKey}
                    onChange={(event) =>
                      setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, sourceKey: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <select
                    value={row.op}
                    onChange={(event) =>
                      setAudienceRules((prev) =>
                        prev.map((entry, idx) =>
                          idx === index ? { ...entry, op: event.target.value as AudienceOp } : entry
                        )
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  >
                    <option value="exists">exists</option>
                    <option value="eq">eq</option>
                    <option value="contains">contains</option>
                    <option value="in">in</option>
                    <option value="gte">gte</option>
                    <option value="lte">lte</option>
                  </select>
                  <input
                    placeholder="value (JSON)"
                    value={row.value}
                    onChange={(event) =>
                      setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, value: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
                  <select
                    value={row.transform}
                    onChange={(event) =>
                      setAudienceRules((prev) =>
                        prev.map((entry, idx) =>
                          idx === index ? { ...entry, transform: event.target.value as AudienceTransform } : entry
                        )
                      )
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  >
                    <option value="takeFirst">takeFirst</option>
                    <option value="takeAll">takeAll</option>
                    <option value="parseJsonIfString">parseJsonIfString</option>
                    <option value="coerceNumber">coerceNumber</option>
                  </select>
                  <input
                    placeholder="id"
                    value={row.id}
                    onChange={(event) =>
                      setAudienceRules((prev) => prev.map((entry, idx) => (idx === index ? { ...entry, id: event.target.value } : entry)))
                    }
                    className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                  />
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
                <input
                  placeholder="sourceKey"
                  value={consentSourceKey}
                  onChange={(event) => setConsentSourceKey(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                />
                <input
                  placeholder="yesValues (comma)"
                  value={consentYesValues}
                  onChange={(event) => setConsentYesValues(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                />
                <input
                  placeholder="noValues (comma)"
                  value={consentNoValues}
                  onChange={(event) => setConsentNoValues(event.target.value)}
                  className="rounded-md border border-stone-300 px-2 py-1 text-sm"
                />
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="panel space-y-3 p-4">
          <div className="flex gap-2">
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={formatJson}>
              Format JSON
            </button>
            <button className="rounded-md border border-stone-300 px-3 py-1 text-sm" onClick={() => void validate()}>
              Validate
            </button>
          </div>
          <textarea
            value={jsonDraft}
            onChange={(event) => setJsonDraft(event.target.value)}
            className="min-h-[28rem] w-full rounded-md border border-stone-300 px-3 py-2 font-mono text-sm"
          />
        </div>
      )}

      {feedback ? <p className="text-sm text-stone-800">{feedback}</p> : null}
      {testMappingOutput ? (
        <section className="panel p-4 text-xs">
          <p className="mb-2 text-sm font-semibold">Test Mapping Output</p>
          <pre className="overflow-auto rounded-md border border-stone-200 bg-stone-50 p-2">{testMappingOutput}</pre>
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
