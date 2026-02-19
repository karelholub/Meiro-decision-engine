import type {
  ActionType,
  AttributeOperator,
  AttributePredicate,
  ConditionNode,
  DecisionDefinition,
  DecisionOutput,
  FlowRule
} from "@decisioning/dsl";

export type FieldDataType = "number" | "string" | "boolean" | "array";

export interface FieldRegistryItem {
  field: string;
  label: string;
  dataType: FieldDataType;
  description?: string;
  common?: boolean;
  sampleValues?: unknown[];
}

export interface ConditionRow {
  id: string;
  field: string;
  op: AttributeOperator;
  value: string;
}

export interface WizardUnsupportedResult {
  supported: boolean;
  reasons: string[];
}

export type WizardStepId = "template" | "basics" | "eligibility" | "rules" | "guardrails" | "fallback" | "test_activate";

export interface WizardStepDefinition {
  id: WizardStepId;
  title: string;
}

export interface MappedValidationError {
  raw: string;
  path: string;
  step: WizardStepId;
  fieldLabel: string;
  message: string;
}

export interface ValidationByStep {
  step: WizardStepId;
  errors: MappedValidationError[];
}

export type SupportedOperator = AttributeOperator;

export type SupportedActionType = ActionType;

export type WizardRule = FlowRule;
export type WizardDefinition = DecisionDefinition;
export type WizardOutput = DecisionOutput;
export type WizardWhen = ConditionNode;
export type WizardAttribute = AttributePredicate;
