import type {
  ActionType,
  AttributeOperator,
  AttributePredicate,
  ConditionNode,
  DecisionDefinition,
  DecisionOutput,
  FlowRule
} from "@decisioning/dsl";
import type {
  ConditionRow,
  FieldDataType,
  FieldRegistryItem,
  MappedValidationError,
  ValidationByStep,
  WizardStepDefinition,
  WizardStepId,
  WizardUnsupportedResult
} from "./types";

const SUPPORTED_OPERATORS = new Set<AttributeOperator>([
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "in",
  "contains",
  "exists"
]);

export const supportedWizardActionTypes: ActionType[] = ["noop", "suppress", "message", "personalize", "experiment"];

const SUPPORTED_TOP_LEVEL_KEYS = new Set([
  "id",
  "key",
  "name",
  "description",
  "status",
  "version",
  "createdAt",
  "updatedAt",
  "activatedAt",
  "holdout",
  "eligibility",
  "performance",
  "cachePolicy",
  "fallback",
  "requiredAttributes",
  "caps",
  "flow",
  "outputs"
]);

const SUPPORTED_HOLDOUT_KEYS = new Set(["enabled", "percentage", "salt"]);
const SUPPORTED_CAP_KEYS = new Set(["perProfilePerDay", "perProfilePerWeek"]);
const SUPPORTED_PERFORMANCE_KEYS = new Set([
  "timeoutMs",
  "wbsTimeoutMs",
  "requiredAttributesOverride",
  "requiredContextKeysOverride"
]);
const SUPPORTED_CACHE_POLICY_KEYS = new Set(["mode", "ttlSeconds", "staleTtlSeconds", "keyContextAllowlist"]);
const SUPPORTED_FALLBACK_KEYS = new Set(["preferStaleCache", "onTimeout", "onError", "defaultOutput"]);
const SUPPORTED_ELIGIBILITY_KEYS = new Set(["audiencesAny", "attributes"]);
const SUPPORTED_RULE_KEYS = new Set(["id", "priority", "when", "then"]);
const SUPPORTED_THEN_KEYS = new Set(["actionType", "payload"]);
const SUPPORTED_OUTPUT_KEYS = new Set(["default"]);

const nowIso = () => new Date().toISOString();

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
};

export const createUuid = () => {
  if (typeof globalThis.crypto !== "undefined" && "randomUUID" in globalThis.crypto) {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
};

export const WIZARD_STEPS: WizardStepDefinition[] = [
  { id: "template", title: "Template" },
  { id: "basics", title: "Basics" },
  { id: "eligibility", title: "Eligibility" },
  { id: "rules", title: "Rules" },
  { id: "guardrails", title: "Guardrails" },
  { id: "fallback", title: "Fallback" },
  { id: "test_activate", title: "Test & Activate" }
];

export const getOperatorsForFieldType = (type: FieldDataType): AttributeOperator[] => {
  if (type === "number") {
    return ["eq", "neq", "gt", "gte", "lt", "lte", "in"];
  }
  if (type === "boolean") {
    return ["eq", "neq"];
  }
  if (type === "array") {
    return ["contains", "exists"];
  }
  return ["eq", "neq", "contains", "in", "exists"];
};

export const getFieldByName = (field: string, registry: FieldRegistryItem[]): FieldRegistryItem | null => {
  return registry.find((entry) => entry.field === field) ?? null;
};

export const getFieldDataType = (field: string, registry: FieldRegistryItem[]): FieldDataType => {
  return getFieldByName(field, registry)?.dataType ?? "string";
};

const parseLoose = (value: string): unknown => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    if (trimmed === "true") {
      return true;
    }
    if (trimmed === "false") {
      return false;
    }
    const numeric = Number(trimmed);
    if (!Number.isNaN(numeric) && `${numeric}` === trimmed) {
      return numeric;
    }
    return trimmed;
  }
};

const parseCsv = (value: string): unknown[] => {
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => parseLoose(entry));
};

export const parseConditionValue = (rawValue: string, type: FieldDataType, op: AttributeOperator): unknown => {
  if (op === "exists") {
    return undefined;
  }

  if (op === "in") {
    if (rawValue.trim().startsWith("[")) {
      const parsed = parseLoose(rawValue);
      return Array.isArray(parsed) ? parsed : parseCsv(rawValue);
    }
    return parseCsv(rawValue);
  }

  if (type === "number") {
    return Number(rawValue);
  }

  if (type === "boolean") {
    return rawValue.trim() === "true";
  }

  return parseLoose(rawValue);
};

const toDisplayValue = (value: unknown): string => {
  if (value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value);
};

export const createConditionRow = (partial?: Partial<ConditionRow>): ConditionRow => {
  return {
    id: partial?.id ?? createUuid(),
    field: partial?.field ?? "",
    op: partial?.op ?? "exists",
    value: partial?.value ?? ""
  };
};

export const COMMON_CONDITION_CHIPS: Array<{
  id: string;
  label: string;
  field: string;
  op: AttributeOperator;
  value?: string;
}> = [
  { id: "email_exists", label: "email exists", field: "email", op: "exists" },
  { id: "purchase_zero", label: "web_purchase_count = 0", field: "web_purchase_count", op: "eq", value: "0" },
  { id: "consent_true", label: "consent_marketing = true", field: "consent_marketing", op: "eq", value: "true" },
  { id: "rfm_lost", label: "rfm = Lost", field: "rfm", op: "eq", value: "Lost" }
];

export const conditionRowFromCommonChip = (chipId: string, registry: FieldRegistryItem[]): ConditionRow | null => {
  const chip = COMMON_CONDITION_CHIPS.find((item) => item.id === chipId);
  if (!chip) {
    return null;
  }
  const fieldMeta = getFieldByName(chip.field, registry);
  if (!fieldMeta) {
    return null;
  }
  const operators = getOperatorsForFieldType(fieldMeta.dataType);
  const op = operators.includes(chip.op) ? chip.op : operators[0] ?? "eq";
  return createConditionRow({
    field: chip.field,
    op,
    value: op === "exists" ? "" : chip.value ?? ""
  });
};

export const conditionRowsToAttributes = (rows: ConditionRow[], registry: FieldRegistryItem[]): AttributePredicate[] => {
  return rows
    .filter((row) => row.field.trim().length > 0)
    .map((row) => {
      const type = getFieldDataType(row.field, registry);
      const base: AttributePredicate = {
        field: row.field.trim(),
        op: row.op
      };
      if (row.op === "exists") {
        return base;
      }

      return {
        ...base,
        value: parseConditionValue(row.value, type, row.op)
      };
    });
};

export const attributesToConditionRows = (attributes: AttributePredicate[], _registry: FieldRegistryItem[]): ConditionRow[] => {
  return attributes.map((attribute, index) =>
    createConditionRow({
      id: `condition-${index}`,
      field: attribute.field,
      op: attribute.op,
      value: toDisplayValue(attribute.value)
    })
  );
};

const ensurePredicateSupport = (predicate: unknown, reasons: Set<string>): predicate is AttributePredicate => {
  if (!isRecord(predicate)) {
    reasons.add("Contains invalid predicate shapes");
    return false;
  }

  if (typeof predicate.field !== "string" || predicate.field.trim().length === 0) {
    reasons.add("Contains predicates without a field");
    return false;
  }

  if (typeof predicate.op !== "string" || !SUPPORTED_OPERATORS.has(predicate.op as AttributeOperator)) {
    reasons.add(`Uses operator '${String(predicate.op)}'`);
    return false;
  }

  return true;
};

export const conditionNodeToAttributes = (
  when: ConditionNode | undefined
): { supported: boolean; attributes: AttributePredicate[]; reasons: string[] } => {
  if (!when) {
    return { supported: true, attributes: [], reasons: [] };
  }

  const reasons = new Set<string>();

  if (when.type === "predicate") {
    if (!ensurePredicateSupport(when.predicate, reasons)) {
      return { supported: false, attributes: [], reasons: [...reasons] };
    }
    return { supported: true, attributes: [when.predicate], reasons: [] };
  }

  if (when.type !== "group") {
    reasons.add("Uses unsupported condition nodes");
    return { supported: false, attributes: [], reasons: [...reasons] };
  }

  if (when.operator !== "all") {
    reasons.add("Uses OR groups");
    return { supported: false, attributes: [], reasons: [...reasons] };
  }

  const attributes: AttributePredicate[] = [];
  for (const child of when.conditions) {
    if (child.type !== "predicate") {
      reasons.add("Uses nested boolean groups");
      continue;
    }
    if (ensurePredicateSupport(child.predicate, reasons)) {
      attributes.push(child.predicate);
    }
  }

  return { supported: reasons.size === 0, attributes, reasons: [...reasons] };
};

export const attributesToConditionNode = (attributes: AttributePredicate[]): ConditionNode | undefined => {
  if (attributes.length === 0) {
    return undefined;
  }

  if (attributes.length === 1) {
    const first = attributes[0];
    if (!first) {
      return undefined;
    }
    return {
      type: "predicate",
      predicate: first
    };
  }

  return {
    type: "group",
    operator: "all",
    conditions: attributes.map((predicate) => ({
      type: "predicate",
      predicate
    }))
  };
};

export const normalizeRulePriorities = (rules: FlowRule[]): FlowRule[] => {
  return rules.map((rule, index) => ({
    ...rule,
    priority: index + 1
  }));
};

const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

export const reorderRules = (rules: FlowRule[], fromIndex: number, toIndex: number): FlowRule[] => {
  if (rules.length < 2 || fromIndex === toIndex) {
    return normalizeRulePriorities(rules);
  }

  const from = clamp(fromIndex, 0, rules.length - 1);
  const to = clamp(toIndex, 0, rules.length - 1);
  const next = [...rules];
  const moved = next[from];
  if (!moved) {
    return normalizeRulePriorities(rules);
  }
  next.splice(from, 1);
  next.splice(to, 0, moved);
  return normalizeRulePriorities(next);
};

const defaultOutput = (): DecisionOutput => ({
  actionType: "noop",
  payload: {}
});

export const createDefaultRule = (priority: number): FlowRule => ({
  id: createUuid(),
  priority,
  then: {
    actionType: "noop",
    payload: {}
  }
});

export const ensureDecisionDefinitionDefaults = (definition: DecisionDefinition): DecisionDefinition => {
  const now = nowIso();
  const normalizedRules = normalizeRulePriorities(definition.flow.rules.length > 0 ? definition.flow.rules : [createDefaultRule(1)]).map(
    (rule) => {
      const actionType: ActionType =
        rule.then && supportedWizardActionTypes.includes(rule.then.actionType) ? rule.then.actionType : "noop";
      const normalizedThen: DecisionOutput = rule.then
        ? {
            actionType,
            payload: isRecord(rule.then.payload) ? rule.then.payload : {}
          }
        : {
            actionType: "noop",
            payload: {}
          };

      return {
        ...rule,
        id: rule.id?.trim() ? rule.id : createUuid(),
        then: normalizedThen
      };
    }
  );

  return {
    ...definition,
    id: definition.id || createUuid(),
    key: definition.key || "decision_key",
    name: definition.name || "Untitled Decision",
    description: definition.description ?? "",
    status: definition.status ?? "DRAFT",
    version: Number.isInteger(definition.version) && definition.version > 0 ? definition.version : 1,
    createdAt: definition.createdAt || now,
    updatedAt: definition.updatedAt || now,
    holdout: {
      ...(definition.holdout ?? {}),
      enabled: Boolean(definition.holdout?.enabled),
      percentage: typeof definition.holdout?.percentage === "number" ? definition.holdout.percentage : 0,
      salt: definition.holdout?.salt || createUuid()
    },
    eligibility: {
      ...(definition.eligibility ?? {}),
      audiencesAny: definition.eligibility?.audiencesAny ?? [],
      attributes: definition.eligibility?.attributes ?? []
    },
    caps: {
      ...(definition.caps ?? {}),
      perProfilePerDay: definition.caps?.perProfilePerDay ?? null,
      perProfilePerWeek: definition.caps?.perProfilePerWeek ?? null
    },
    performance: {
      timeoutMs: definition.performance?.timeoutMs ?? 120,
      wbsTimeoutMs: definition.performance?.wbsTimeoutMs ?? 80,
      requiredAttributesOverride: definition.performance?.requiredAttributesOverride ?? [],
      requiredContextKeysOverride: definition.performance?.requiredContextKeysOverride ?? []
    },
    cachePolicy: {
      mode: definition.cachePolicy?.mode ?? "normal",
      ttlSeconds: definition.cachePolicy?.ttlSeconds ?? 60,
      staleTtlSeconds: definition.cachePolicy?.staleTtlSeconds ?? 1800,
      keyContextAllowlist: definition.cachePolicy?.keyContextAllowlist ?? ["appKey", "placement"]
    },
    fallback: {
      preferStaleCache: definition.fallback?.preferStaleCache ?? false,
      defaultOutput: definition.fallback?.defaultOutput ?? "default",
      onTimeout: definition.fallback?.onTimeout,
      onError: definition.fallback?.onError
    },
    flow: {
      rules: normalizedRules
    },
    outputs: {
      ...(definition.outputs ?? {}),
      default: definition.outputs.default ?? defaultOutput()
    }
  };
};

const addReason = (reasons: Set<string>, reason: string) => {
  if (reason.trim()) {
    reasons.add(reason);
  }
};

const checkKnownKeys = (target: Record<string, unknown>, supported: Set<string>, reasons: Set<string>, prefix: string) => {
  for (const key of Object.keys(target)) {
    if (!supported.has(key)) {
      addReason(reasons, `${prefix} uses unsupported key '${key}'`);
    }
  }
};

const isSupportedActionType = (actionType: unknown): actionType is ActionType => {
  return typeof actionType === "string" && supportedWizardActionTypes.includes(actionType as ActionType);
};

const inspectWhenNode = (when: unknown, reasons: Set<string>) => {
  if (!when) {
    return;
  }
  if (!isRecord(when)) {
    addReason(reasons, "Contains invalid rule conditions");
    return;
  }

  if (when.type === "predicate") {
    if (!ensurePredicateSupport(when.predicate, reasons)) {
      return;
    }
    return;
  }

  if (when.type !== "group") {
    addReason(reasons, "Contains unsupported rule condition nodes");
    return;
  }

  if (when.operator !== "all") {
    addReason(reasons, "Uses OR groups");
    return;
  }

  if (!Array.isArray(when.conditions)) {
    addReason(reasons, "Contains invalid boolean groups");
    return;
  }

  for (const child of when.conditions) {
    if (!isRecord(child) || child.type !== "predicate") {
      addReason(reasons, "Uses nested boolean groups");
      continue;
    }
    ensurePredicateSupport(child.predicate, reasons);
  }
};

export const detectWizardUnsupported = (decisionJson: unknown): WizardUnsupportedResult => {
  const reasons = new Set<string>();

  if (!isRecord(decisionJson)) {
    return {
      supported: false,
      reasons: ["Decision is not a valid JSON object"]
    };
  }

  checkKnownKeys(decisionJson, SUPPORTED_TOP_LEVEL_KEYS, reasons, "Decision");

  if ("policies" in decisionJson) {
    addReason(reasons, "Uses policies configuration");
  }

  if ("writeback" in decisionJson) {
    addReason(reasons, "Uses writeback configuration");
  }

  if (!isRecord(decisionJson.holdout)) {
    addReason(reasons, "Missing holdout configuration");
  } else {
    checkKnownKeys(decisionJson.holdout, SUPPORTED_HOLDOUT_KEYS, reasons, "Holdout");
  }

  if (!isRecord(decisionJson.caps)) {
    addReason(reasons, "Missing caps configuration");
  } else {
    checkKnownKeys(decisionJson.caps, SUPPORTED_CAP_KEYS, reasons, "Caps");
  }

  if (decisionJson.performance !== undefined) {
    if (!isRecord(decisionJson.performance)) {
      addReason(reasons, "Performance configuration must be a JSON object");
    } else {
      checkKnownKeys(decisionJson.performance, SUPPORTED_PERFORMANCE_KEYS, reasons, "Performance");
    }
  }

  if (decisionJson.cachePolicy !== undefined) {
    if (!isRecord(decisionJson.cachePolicy)) {
      addReason(reasons, "Cache policy configuration must be a JSON object");
    } else {
      checkKnownKeys(decisionJson.cachePolicy, SUPPORTED_CACHE_POLICY_KEYS, reasons, "Cache policy");
    }
  }

  if (decisionJson.fallback !== undefined) {
    if (!isRecord(decisionJson.fallback)) {
      addReason(reasons, "Fallback configuration must be a JSON object");
    } else {
      checkKnownKeys(decisionJson.fallback, SUPPORTED_FALLBACK_KEYS, reasons, "Fallback");
      if (decisionJson.fallback.onTimeout && !isRecord(decisionJson.fallback.onTimeout)) {
        addReason(reasons, "fallback.onTimeout must be a JSON object");
      }
      if (decisionJson.fallback.onError && !isRecord(decisionJson.fallback.onError)) {
        addReason(reasons, "fallback.onError must be a JSON object");
      }
      if (isRecord(decisionJson.fallback.onTimeout)) {
        checkKnownKeys(decisionJson.fallback.onTimeout, new Set(["actionType", "payload", "ttl_seconds", "tracking"]), reasons, "Fallback onTimeout");
      }
      if (isRecord(decisionJson.fallback.onError)) {
        checkKnownKeys(decisionJson.fallback.onError, new Set(["actionType", "payload", "ttl_seconds", "tracking"]), reasons, "Fallback onError");
      }
    }
  }

  if (!isRecord(decisionJson.eligibility)) {
    addReason(reasons, "Missing eligibility configuration");
  } else {
    const eligibility = decisionJson.eligibility;
    checkKnownKeys(eligibility, SUPPORTED_ELIGIBILITY_KEYS, reasons, "Eligibility");

    if (Array.isArray(eligibility.audiencesAll) && eligibility.audiencesAll.length > 0) {
      addReason(reasons, "Uses audiencesAll eligibility");
    }

    if (Array.isArray(eligibility.audiencesNone) && eligibility.audiencesNone.length > 0) {
      addReason(reasons, "Uses audiencesNone eligibility");
    }

    if (eligibility.consent) {
      addReason(reasons, "Uses consent eligibility blocks");
    }

    if (Array.isArray(eligibility.attributes)) {
      for (const predicate of eligibility.attributes) {
        ensurePredicateSupport(predicate, reasons);
      }
    }
  }

  if (!isRecord(decisionJson.flow) || !Array.isArray(decisionJson.flow.rules)) {
    addReason(reasons, "Missing flow.rules");
  } else {
    for (const rule of decisionJson.flow.rules) {
      if (!isRecord(rule)) {
        addReason(reasons, "Contains invalid rules");
        continue;
      }
      checkKnownKeys(rule, SUPPORTED_RULE_KEYS, reasons, "Rule");

      if ("else" in rule) {
        addReason(reasons, "Uses ELSE rule branches");
      }

      if (!rule.id || typeof rule.id !== "string") {
        addReason(reasons, "Contains rules without an id");
      }

      inspectWhenNode(rule.when, reasons);

      if (!isRecord(rule.then)) {
        addReason(reasons, "Contains rules without THEN actions");
        continue;
      }

      checkKnownKeys(rule.then, SUPPORTED_THEN_KEYS, reasons, "Rule THEN");

      if (!isSupportedActionType(rule.then.actionType)) {
        addReason(reasons, `Uses unsupported action type '${String(rule.then.actionType)}'`);
      }

      if (!isRecord(rule.then.payload)) {
        addReason(reasons, "Rule payload must be a JSON object");
      }
    }
  }

  if (!isRecord(decisionJson.outputs)) {
    addReason(reasons, "Missing outputs block");
  } else {
    checkKnownKeys(decisionJson.outputs, SUPPORTED_OUTPUT_KEYS, reasons, "Outputs");

    if (decisionJson.outputs.default !== undefined) {
      if (!isRecord(decisionJson.outputs.default)) {
        addReason(reasons, "Default output must be a JSON object");
      } else {
        checkKnownKeys(decisionJson.outputs.default, SUPPORTED_THEN_KEYS, reasons, "Default output");
        if (!isSupportedActionType(decisionJson.outputs.default.actionType)) {
          addReason(reasons, `Uses unsupported default action type '${String(decisionJson.outputs.default.actionType)}'`);
        }
      }
    }
  }

  return {
    supported: reasons.size === 0,
    reasons: [...reasons]
  };
};

const humanizeFieldToken = (value: string) => {
  return value
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (char) => char.toUpperCase());
};

const pathToStep = (path: string): WizardStepId => {
  if (path.startsWith("performance.") || path.startsWith("cachePolicy.") || path.startsWith("fallback.")) {
    return "fallback";
  }
  if (path.startsWith("eligibility.")) {
    return "eligibility";
  }
  if (path.startsWith("flow.rules")) {
    return "rules";
  }
  if (path.startsWith("holdout") || path.startsWith("caps")) {
    return "guardrails";
  }
  if (path.startsWith("outputs.default")) {
    return "fallback";
  }
  if (path.startsWith("name") || path.startsWith("key") || path.startsWith("description")) {
    return "basics";
  }
  return "test_activate";
};

const buildFieldLabel = (path: string, message: string): string => {
  const eligibilityMatch = path.match(/^eligibility\.attributes\.(\d+)\.(.+)$/);
  if (eligibilityMatch) {
    const index = Number(eligibilityMatch[1]) + 1;
    const token = eligibilityMatch[2] ?? "value";
    return `Eligibility -> Condition #${index}: ${humanizeFieldToken(token)} ${message || "is invalid"}`;
  }

  const ruleMatch = path.match(/^flow\.rules\.(\d+)\.(.+)$/);
  if (ruleMatch) {
    const index = Number(ruleMatch[1]) + 1;
    const token = ruleMatch[2] ?? "rule";
    if (token.startsWith("then")) {
      return `Rules -> Rule #${index}: Then action ${message || "is required"}`;
    }
    if (token.startsWith("when")) {
      return `Rules -> Rule #${index}: When condition ${message || "is invalid"}`;
    }
    return `Rules -> Rule #${index}: ${humanizeFieldToken(token)} ${message || "is invalid"}`;
  }

  if (path.startsWith("outputs.default")) {
    return `Fallback -> Default output ${message || "is invalid"}`;
  }

  if (path.startsWith("performance.")) {
    return `Fallback -> Performance ${message || "is invalid"}`;
  }

  if (path.startsWith("cachePolicy.")) {
    return `Fallback -> Cache policy ${message || "is invalid"}`;
  }

  if (path.startsWith("fallback.")) {
    return `Fallback -> Runtime fallback ${message || "is invalid"}`;
  }

  if (path.startsWith("holdout.")) {
    return `Guardrails -> Holdout ${message || "is invalid"}`;
  }

  if (path.startsWith("caps.")) {
    return `Guardrails -> Caps ${message || "is invalid"}`;
  }

  if (path.startsWith("name") || path.startsWith("key") || path.startsWith("description")) {
    return `Basics -> ${humanizeFieldToken(path)} ${message || "is invalid"}`;
  }

  return `${humanizeFieldToken(path)} ${message || "is invalid"}`;
};

const parseValidationError = (error: string): { path: string; message: string } => {
  const trimmed = error.trim();
  if (!trimmed) {
    return { path: "", message: "" };
  }

  const [pathToken, ...messageTokens] = trimmed.split(/\s+/);
  const path = pathToken ?? "";
  const message = messageTokens.join(" ");
  return { path, message };
};

export const mapValidationErrors = (errors: string[]): MappedValidationError[] => {
  return errors.map((raw) => {
    const parsed = parseValidationError(raw);
    const step = pathToStep(parsed.path);
    const message = parsed.message || "is invalid";

    return {
      raw,
      path: parsed.path,
      step,
      fieldLabel: buildFieldLabel(parsed.path, message),
      message
    };
  });
};

export const groupValidationErrorsByStep = (errors: MappedValidationError[]): ValidationByStep[] => {
  const map = new Map<WizardStepId, MappedValidationError[]>();

  for (const error of errors) {
    const existing = map.get(error.step) ?? [];
    existing.push(error);
    map.set(error.step, existing);
  }

  return WIZARD_STEPS.map((step) => ({
    step: step.id,
    errors: map.get(step.id) ?? []
  })).filter((group) => group.errors.length > 0);
};

export const toErrorPathMap = (errors: MappedValidationError[]): Record<string, string> => {
  const next: Record<string, string> = {};
  for (const error of errors) {
    if (error.path && !next[error.path]) {
      next[error.path] = error.message;
    }
  }
  return next;
};

export const getDecisionSummaryText = (definition: DecisionDefinition): string => {
  const audienceSummary = definition.eligibility.audiencesAny?.length
    ? `for audiences ${definition.eligibility.audiencesAny.join(", ")}`
    : "for all audiences";
  const conditionCount = definition.eligibility.attributes?.length ?? 0;
  const rulesCount = definition.flow.rules.length;
  const holdout = definition.holdout.enabled ? `${definition.holdout.percentage}% holdout` : "no holdout";
  const timeout = definition.performance?.timeoutMs ?? 120;
  const cacheMode = definition.cachePolicy?.mode ?? "normal";

  return `This decision evaluates ${conditionCount} eligibility condition${conditionCount === 1 ? "" : "s"} ${audienceSummary}, applies ${rulesCount} rule${rulesCount === 1 ? "" : "s"}, runs with ${holdout}, timeout ${timeout}ms, and cache mode ${cacheMode}.`;
};

const collectConditionFields = (condition: ConditionNode, fields: Set<string>) => {
  if (condition.type === "predicate") {
    if (condition.predicate.field.trim()) {
      fields.add(condition.predicate.field.trim());
    }
    return;
  }

  for (const child of condition.conditions) {
    collectConditionFields(child, fields);
  }
};

export const deriveWizardRequiredAttributes = (definition: DecisionDefinition): string[] => {
  const fields = new Set<string>();

  for (const field of definition.requiredAttributes ?? []) {
    if (field.trim()) {
      fields.add(field.trim());
    }
  }
  for (const field of definition.performance?.requiredAttributesOverride ?? []) {
    if (field.trim()) {
      fields.add(field.trim());
    }
  }
  for (const predicate of definition.eligibility.attributes ?? []) {
    if (predicate.field.trim()) {
      fields.add(predicate.field.trim());
    }
  }
  for (const rule of definition.flow.rules) {
    if (rule.when) {
      collectConditionFields(rule.when, fields);
    }
  }

  return [...fields].sort((left, right) => left.localeCompare(right));
};

export const deriveRequiredFieldsFromDraft = (definition: DecisionDefinition): {
  requiredAttributes: string[];
  requiredAudiences: string[];
  requiredContextKeys: string[];
} => {
  const attributeSet = new Set<string>();
  const audienceSet = new Set<string>();
  const contextSet = new Set<string>();

  for (const audience of definition.eligibility.audiencesAny ?? []) {
    const trimmed = audience.trim();
    if (trimmed) {
      audienceSet.add(trimmed);
    }
  }

  for (const field of deriveWizardRequiredAttributes(definition)) {
    const trimmed = field.trim();
    if (!trimmed) {
      continue;
    }
    if (trimmed.startsWith("context.") || trimmed.startsWith("ctx.")) {
      contextSet.add(trimmed);
      continue;
    }
    attributeSet.add(trimmed);
  }

  for (const key of definition.performance?.requiredContextKeysOverride ?? []) {
    const trimmed = key.trim();
    if (trimmed) {
      contextSet.add(trimmed);
    }
  }

  return {
    requiredAttributes: [...attributeSet].sort((left, right) => left.localeCompare(right)),
    requiredAudiences: [...audienceSet].sort((left, right) => left.localeCompare(right)),
    requiredContextKeys: [...contextSet].sort((left, right) => left.localeCompare(right))
  };
};

export const draftRiskFlags = (definition: DecisionDefinition): {
  appliesToEveryone: boolean;
  messagingWithoutCaps: boolean;
} => {
  const appliesToEveryone = (definition.eligibility.attributes?.length ?? 0) === 0 && (definition.eligibility.audiencesAny?.length ?? 0) === 0;
  const usesMessaging =
    definition.outputs.default?.actionType === "message" || definition.flow.rules.some((rule) => rule.then.actionType === "message");
  const messagingWithoutCaps = usesMessaging && !definition.caps.perProfilePerDay && !definition.caps.perProfilePerWeek;
  return {
    appliesToEveryone,
    messagingWithoutCaps
  };
};
