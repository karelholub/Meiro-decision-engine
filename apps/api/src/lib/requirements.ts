import type { ConditionNode, DecisionDefinition, DecisionStackDefinition } from "@decisioning/dsl";

const TOKEN_PATTERN = /\{\{\s*([^}]+)\s*\}\}/g;

const uniqueSorted = (values: Iterable<string>): string[] => {
  return [...new Set([...values].map((entry) => entry.trim()).filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  );
};

const getContextRootKey = (path: string): string => {
  const trimmed = path.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(".")[0] ?? "";
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

const collectTokenExpression = (
  expression: string,
  target: {
    attributes: Set<string>;
    contextKeys: Set<string>;
  }
) => {
  const trimmed = expression.trim();
  if (!trimmed) {
    return;
  }

  if (trimmed.startsWith("profile.")) {
    target.attributes.add(trimmed.slice("profile.".length));
    return;
  }

  if (trimmed.startsWith("context.")) {
    const root = getContextRootKey(trimmed.slice("context.".length));
    if (root) {
      target.contextKeys.add(root);
    }
  }
};

const collectTemplateTokens = (
  value: unknown,
  target: {
    attributes: Set<string>;
    contextKeys: Set<string>;
    referencedContentKeys: Set<string>;
  }
) => {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectTemplateTokens(entry, target);
    }
    return;
  }

  if (!value || typeof value !== "object") {
    if (typeof value === "string") {
      for (const match of value.matchAll(TOKEN_PATTERN)) {
        collectTokenExpression(match[1] ?? "", target);
      }
      collectTokenExpression(value, target);
    }
    return;
  }

  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (key === "payloadRef" && nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      const payloadRef = nestedValue as Record<string, unknown>;
      if (typeof payloadRef.contentKey === "string" && payloadRef.contentKey.trim().length > 0) {
        target.referencedContentKeys.add(payloadRef.contentKey.trim());
      }
    }

    if (key === "templateVars" && nestedValue && typeof nestedValue === "object" && !Array.isArray(nestedValue)) {
      for (const path of Object.values(nestedValue as Record<string, unknown>)) {
        if (typeof path === "string") {
          collectTokenExpression(path, target);
        }
      }
    }

    collectTemplateTokens(nestedValue, target);
  }
};

const collectDecisionTemplateRequirements = (definition: DecisionDefinition) => {
  const attributes = new Set<string>();
  const contextKeys = new Set<string>();
  const referencedContentKeys = new Set<string>();

  const target = {
    attributes,
    contextKeys,
    referencedContentKeys
  };

  for (const rule of definition.flow.rules) {
    collectTemplateTokens(rule.then, target);
    if (rule.else) {
      collectTemplateTokens(rule.else, target);
    }
  }

  for (const output of Object.values(definition.outputs ?? {})) {
    collectTemplateTokens(output, target);
  }

  return {
    attributes: uniqueSorted(attributes),
    contextKeys: uniqueSorted(contextKeys),
    referencedContentKeys: uniqueSorted(referencedContentKeys)
  };
};

export const collectDecisionReferencedContentKeys = (definition: DecisionDefinition): string[] => {
  return collectDecisionTemplateRequirements(definition).referencedContentKeys;
};

const parseTokenBindingPath = (binding: unknown): string | null => {
  if (typeof binding === "string" && binding.trim().length > 0) {
    return binding.trim();
  }
  if (binding && typeof binding === "object" && !Array.isArray(binding)) {
    const sourcePath = (binding as Record<string, unknown>).sourcePath;
    if (typeof sourcePath === "string" && sourcePath.trim().length > 0) {
      return sourcePath.trim();
    }
  }
  return null;
};

const collectContentBlockRequirements = (input: {
  tokenBindings: unknown;
  localesJson: unknown;
}): { attributes: string[]; contextKeys: string[] } => {
  const attributes = new Set<string>();
  const contextKeys = new Set<string>();

  if (input.tokenBindings && typeof input.tokenBindings === "object" && !Array.isArray(input.tokenBindings)) {
    for (const binding of Object.values(input.tokenBindings as Record<string, unknown>)) {
      const path = parseTokenBindingPath(binding);
      if (!path) {
        continue;
      }
      collectTokenExpression(path, {
        attributes,
        contextKeys
      });
    }
  }

  collectTemplateTokens(input.localesJson, {
    attributes,
    contextKeys,
    referencedContentKeys: new Set<string>()
  });

  return {
    attributes: uniqueSorted(attributes),
    contextKeys: uniqueSorted(contextKeys)
  };
};

export interface RequirementsSummary {
  required: {
    attributes: string[];
    audiences: string[];
    contextKeys: string[];
  };
  optional: {
    attributes: string[];
    contextKeys: string[];
  };
  notes: string[];
}

export interface ContentBlockRequirementsSource {
  key: string;
  tokenBindings: unknown;
  localesJson: unknown;
}

export const deriveDecisionRequiredAttributes = (definition: DecisionDefinition): string[] => {
  const fields = new Set<string>(definition.requiredAttributes ?? []);
  for (const predicate of definition.eligibility.attributes ?? []) {
    fields.add(predicate.field);
  }

  for (const rule of definition.flow.rules) {
    if (rule.when) {
      collectConditionFields(rule.when, fields);
    }
  }

  for (const override of definition.performance?.requiredAttributesOverride ?? []) {
    fields.add(override);
  }

  return uniqueSorted(fields);
};

export const deriveDecisionRequirements = (
  definition: DecisionDefinition,
  contentBlocksByKey: Record<string, ContentBlockRequirementsSource> = {}
): RequirementsSummary => {
  const requiredAttributes = new Set<string>(deriveDecisionRequiredAttributes(definition));
  const requiredAudiences = new Set<string>([
    ...(definition.eligibility.audiencesAll ?? []),
    ...(definition.eligibility.audiencesAny ?? []),
    ...(definition.eligibility.audiencesNone ?? [])
  ]);
  const requiredContextKeys = new Set<string>(definition.performance?.requiredContextKeysOverride ?? []);

  const optionalAttributes = new Set<string>();
  const optionalContextKeys = new Set<string>();
  const notes: string[] = [];

  const templateRequirements = collectDecisionTemplateRequirements(definition);
  for (const field of templateRequirements.attributes) {
    optionalAttributes.add(field);
  }
  for (const contextKey of templateRequirements.contextKeys) {
    optionalContextKeys.add(contextKey);
  }

  if (templateRequirements.referencedContentKeys.length > 0) {
    const missingContentKeys = new Set<string>();

    for (const key of templateRequirements.referencedContentKeys) {
      const content = contentBlocksByKey[key];
      if (!content) {
        missingContentKeys.add(key);
        continue;
      }

      const fromContent = collectContentBlockRequirements({
        tokenBindings: content.tokenBindings,
        localesJson: content.localesJson
      });

      for (const field of fromContent.attributes) {
        optionalAttributes.add(field);
      }
      for (const contextKey of fromContent.contextKeys) {
        optionalContextKeys.add(contextKey);
      }
    }

    if (missingContentKeys.size > 0) {
      notes.push(
        `Some referenced content blocks were not found in ACTIVE status: ${uniqueSorted(missingContentKeys).join(", ")}`
      );
    }
  }

  for (const field of requiredAttributes) {
    optionalAttributes.delete(field);
  }
  for (const contextKey of requiredContextKeys) {
    optionalContextKeys.delete(contextKey);
  }

  return {
    required: {
      attributes: uniqueSorted(requiredAttributes),
      audiences: uniqueSorted(requiredAudiences),
      contextKeys: uniqueSorted(requiredContextKeys)
    },
    optional: {
      attributes: uniqueSorted(optionalAttributes),
      contextKeys: uniqueSorted(optionalContextKeys)
    },
    notes
  };
};

export const deriveStackRequiredAttributes = (
  stack: DecisionStackDefinition,
  decisionsByKey: Record<string, DecisionDefinition>
): string[] => {
  const fields = new Set<string>(stack.requiredAttributes ?? []);
  for (const step of stack.steps) {
    const definition = decisionsByKey[step.decisionKey];
    if (!definition) {
      continue;
    }
    for (const field of deriveDecisionRequiredAttributes(definition)) {
      fields.add(field);
    }
  }

  return uniqueSorted(fields);
};

export const deriveStackRequirements = (input: {
  stack: DecisionStackDefinition;
  decisionsByKey: Record<string, DecisionDefinition>;
  decisionRequirementsByKey: Record<string, RequirementsSummary>;
}): RequirementsSummary => {
  const requiredAttributes = new Set<string>();
  const requiredAudiences = new Set<string>();
  const requiredContextKeys = new Set<string>();
  const optionalAttributes = new Set<string>();
  const optionalContextKeys = new Set<string>();
  const notes: string[] = [];

  for (const step of input.stack.steps) {
    const decisionRequirements = input.decisionRequirementsByKey[step.decisionKey];
    if (!decisionRequirements) {
      notes.push(`Active decision not found for stack step '${step.id}' (${step.decisionKey}).`);
      continue;
    }

    for (const field of decisionRequirements.required.attributes) {
      requiredAttributes.add(field);
    }
    for (const audience of decisionRequirements.required.audiences) {
      requiredAudiences.add(audience);
    }
    for (const key of decisionRequirements.required.contextKeys) {
      requiredContextKeys.add(key);
    }

    for (const field of decisionRequirements.optional.attributes) {
      optionalAttributes.add(field);
    }
    for (const key of decisionRequirements.optional.contextKeys) {
      optionalContextKeys.add(key);
    }
    for (const note of decisionRequirements.notes) {
      notes.push(`[${step.decisionKey}] ${note}`);
    }

    if (step.when?.left.startsWith("context.")) {
      const root = getContextRootKey(step.when.left.slice("context.".length));
      if (root) {
        requiredContextKeys.add(root);
      }
    }
    if (typeof step.when?.right === "string" && step.when.right.startsWith("context.")) {
      const root = getContextRootKey(step.when.right.slice("context.".length));
      if (root) {
        requiredContextKeys.add(root);
      }
    }
  }

  if (input.stack.requiredAttributes && input.stack.requiredAttributes.length > 0) {
    for (const field of input.stack.requiredAttributes) {
      requiredAttributes.add(field);
    }
  }

  for (const field of requiredAttributes) {
    optionalAttributes.delete(field);
  }
  for (const contextKey of requiredContextKeys) {
    optionalContextKeys.delete(contextKey);
  }

  return {
    required: {
      attributes: uniqueSorted(requiredAttributes),
      audiences: uniqueSorted(requiredAudiences),
      contextKeys: uniqueSorted(requiredContextKeys)
    },
    optional: {
      attributes: uniqueSorted(optionalAttributes),
      contextKeys: uniqueSorted(optionalContextKeys)
    },
    notes: uniqueSorted(notes)
  };
};
