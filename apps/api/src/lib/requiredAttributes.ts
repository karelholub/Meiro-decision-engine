import type { ConditionNode, DecisionDefinition, DecisionStackDefinition } from "@decisioning/dsl";

const uniqueSorted = (values: string[]): string[] => {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))].sort();
};

const collectConditionFields = (node: ConditionNode, target: Set<string>) => {
  if (node.type === "predicate") {
    target.add(node.predicate.field);
    return;
  }

  for (const child of node.conditions) {
    collectConditionFields(child, target);
  }
};

export const deriveDecisionRequiredAttributes = (definition: DecisionDefinition): string[] => {
  if (definition.requiredAttributes && definition.requiredAttributes.length > 0) {
    return uniqueSorted(definition.requiredAttributes);
  }

  const fields = new Set<string>();
  for (const predicate of definition.eligibility.attributes ?? []) {
    fields.add(predicate.field);
  }

  for (const rule of definition.flow.rules) {
    if (rule.when) {
      collectConditionFields(rule.when, fields);
    }
  }

  return uniqueSorted([...fields]);
};

export const deriveStackRequiredAttributes = (
  stack: DecisionStackDefinition,
  decisionsByKey: Record<string, DecisionDefinition>
): string[] => {
  if (stack.requiredAttributes && stack.requiredAttributes.length > 0) {
    return uniqueSorted(stack.requiredAttributes);
  }

  const fields = new Set<string>();
  for (const step of stack.steps) {
    const definition = decisionsByKey[step.decisionKey];
    if (!definition) {
      continue;
    }
    for (const field of deriveDecisionRequiredAttributes(definition)) {
      fields.add(field);
    }
  }

  return uniqueSorted([...fields]);
};
