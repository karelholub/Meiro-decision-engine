import type { Environment, PrismaClient } from "@prisma/client";
import type { EngineContext, EngineProfile } from "@decisioning/engine";

const TOKEN_PATTERN = /\{\{\s*([^}]+)\s*\}\}/g;

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const toRecord = (value: unknown): Record<string, unknown> => {
  return isObject(value) ? value : {};
};

const getValueByPath = (source: unknown, path: string): unknown => {
  if (!path) {
    return source;
  }
  return path.split(".").reduce<unknown>((current, part) => {
    if (!part) {
      return current;
    }
    if (Array.isArray(current)) {
      const index = Number.parseInt(part, 10);
      return Number.isFinite(index) ? current[index] : undefined;
    }
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[part];
    }
    return undefined;
  }, source);
};

const normalizeTags = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }
  return [...new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0))];
};

const normalizeTokenBindings = (value: unknown): Record<string, string> => {
  if (!isObject(value)) {
    return {};
  }

  const output: Record<string, string> = {};
  for (const [token, bindingRaw] of Object.entries(value)) {
    if (typeof bindingRaw === "string" && bindingRaw.trim().length > 0) {
      output[token] = bindingRaw.trim();
      continue;
    }
    if (isObject(bindingRaw) && typeof bindingRaw.sourcePath === "string" && bindingRaw.sourcePath.trim().length > 0) {
      output[token] = bindingRaw.sourcePath.trim();
    }
  }
  return output;
};

const parseLocaleMap = (value: unknown): Record<string, unknown> => {
  return isObject(value) ? value : {};
};

const pickLocalePayload = (input: { locales: Record<string, unknown>; requestedLocale?: string }): { locale: string; payload: unknown } => {
  const requested = input.requestedLocale?.trim();
  if (requested && requested in input.locales) {
    return {
      locale: requested,
      payload: input.locales[requested]
    };
  }

  const languageOnly = requested?.split("-")[0];
  if (languageOnly && languageOnly in input.locales) {
    return {
      locale: languageOnly,
      payload: input.locales[languageOnly]
    };
  }

  if ("en" in input.locales) {
    return {
      locale: "en",
      payload: input.locales.en
    };
  }

  const [firstLocale] = Object.keys(input.locales);
  if (firstLocale) {
    return {
      locale: firstLocale,
      payload: input.locales[firstLocale]
    };
  }

  return {
    locale: requested ?? "en",
    payload: {}
  };
};

export const isWithinWindow = (input: { now: Date; startAt?: Date | null; endAt?: Date | null }): boolean => {
  if (input.startAt && input.startAt.getTime() > input.now.getTime()) {
    return false;
  }
  if (input.endAt && input.endAt.getTime() < input.now.getTime()) {
    return false;
  }
  return true;
};

interface RenderTemplateInput {
  value: unknown;
  profile: Record<string, unknown>;
  context: Record<string, unknown>;
  derived: Record<string, unknown>;
  tokenBindings: Record<string, string>;
  missingTokenValue: string;
  missingTokens: Set<string>;
}

const resolveTokenExpression = (input: {
  expression: string;
  profile: Record<string, unknown>;
  context: Record<string, unknown>;
  derived: Record<string, unknown>;
  tokenBindings: Record<string, string>;
}): unknown => {
  const expression = input.expression.trim();
  if (!expression) {
    return undefined;
  }

  if (expression.startsWith("profile.")) {
    return getValueByPath(input.profile, expression.slice("profile.".length));
  }
  if (expression.startsWith("context.")) {
    return getValueByPath(input.context, expression.slice("context.".length));
  }
  if (expression.startsWith("derived.")) {
    return getValueByPath(input.derived, expression.slice("derived.".length));
  }

  if (expression in input.tokenBindings) {
    return getValueByPath(
      {
        profile: input.profile,
        context: input.context,
        derived: input.derived
      },
      input.tokenBindings[expression] as string
    );
  }

  const [root, ...rest] = expression.split(".");
  if (root && root in input.tokenBindings) {
    const base = getValueByPath(
      {
        profile: input.profile,
        context: input.context,
        derived: input.derived
      },
      input.tokenBindings[root] as string
    );
    return rest.length > 0 ? getValueByPath(base, rest.join(".")) : base;
  }

  if (expression in input.derived) {
    return input.derived[expression];
  }
  if (expression in input.context) {
    return input.context[expression];
  }
  if (expression in input.profile) {
    return input.profile[expression];
  }

  return undefined;
};

export const renderTemplateWithCatalogTokens = (input: RenderTemplateInput): unknown => {
  if (Array.isArray(input.value)) {
    return input.value.map((entry) => renderTemplateWithCatalogTokens({ ...input, value: entry }));
  }

  if (isObject(input.value)) {
    const next: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input.value)) {
      next[key] = renderTemplateWithCatalogTokens({ ...input, value: nested });
    }
    return next;
  }

  if (typeof input.value !== "string") {
    return input.value;
  }

  const fullMatch = input.value.match(/^\{\{\s*([^}]+)\s*\}\}$/);
  if (fullMatch?.[1]) {
    const resolved = resolveTokenExpression({
      expression: fullMatch[1],
      profile: input.profile,
      context: input.context,
      derived: input.derived,
      tokenBindings: input.tokenBindings
    });
    if (resolved === undefined || resolved === null) {
      input.missingTokens.add(fullMatch[1].trim());
      return input.missingTokenValue;
    }
    return resolved;
  }

  return input.value.replace(TOKEN_PATTERN, (_match, expressionRaw: string) => {
    const expression = expressionRaw.trim();
    const resolved = resolveTokenExpression({
      expression,
      profile: input.profile,
      context: input.context,
      derived: input.derived,
      tokenBindings: input.tokenBindings
    });
    if (resolved === undefined || resolved === null) {
      input.missingTokens.add(expression);
      return input.missingTokenValue;
    }
    if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
      return String(resolved);
    }
    return JSON.stringify(resolved);
  });
};

export interface ResolvedOffer {
  key: string;
  version: number;
  type: string;
  value: Record<string, unknown>;
  constraints: Record<string, unknown>;
  tags: string[];
  valid: boolean;
}

export interface ResolvedContent {
  key: string;
  version: number;
  templateId: string;
  locale: string;
  payload: unknown;
  tags: string[];
  missingTokens: string[];
}

interface CatalogResolverDeps {
  prisma: PrismaClient;
  now?: () => Date;
  missingTokenValue?: string;
}

export const createCatalogResolver = (deps: CatalogResolverDeps) => {
  const nowFn = deps.now ?? (() => new Date());

  const resolveOffer = async (input: {
    environment: Environment;
    offerKey: string;
    now?: Date;
  }): Promise<ResolvedOffer | null> => {
    const offer = await deps.prisma.offer.findFirst({
      where: {
        environment: input.environment,
        key: input.offerKey,
        status: "ACTIVE"
      },
      orderBy: {
        version: "desc"
      }
    });

    if (!offer) {
      return null;
    }

    const effectiveNow = input.now ?? nowFn();
    const valid = isWithinWindow({
      now: effectiveNow,
      startAt: offer.startAt,
      endAt: offer.endAt
    });

    return {
      key: offer.key,
      version: offer.version,
      type: offer.type,
      value: isObject(offer.valueJson) ? offer.valueJson : {},
      constraints: isObject(offer.constraints) ? offer.constraints : {},
      tags: normalizeTags(offer.tags),
      valid
    };
  };

  const resolveContent = async (input: {
    environment: Environment;
    contentKey: string;
    locale?: string;
    profile?: EngineProfile | Record<string, unknown>;
    context?: Record<string, unknown>;
    derived?: Record<string, unknown>;
    now?: Date;
    missingTokenValue?: string;
  }): Promise<ResolvedContent | null> => {
    const content = await deps.prisma.contentBlock.findFirst({
      where: {
        environment: input.environment,
        key: input.contentKey,
        status: "ACTIVE"
      },
      orderBy: {
        version: "desc"
      }
    });

    if (!content) {
      return null;
    }

    const locales = parseLocaleMap(content.localesJson);
    const picked = pickLocalePayload({ locales, requestedLocale: input.locale });
    const missingTokens = new Set<string>();
    const missingTokenValue = input.missingTokenValue ?? deps.missingTokenValue ?? "";

    const profileObject = input.profile
      ? (isObject(input.profile)
          ? input.profile
          : {
              profileId: input.profile.profileId,
              attributes: input.profile.attributes,
              audiences: input.profile.audiences,
              consents: input.profile.consents ?? []
            })
      : {};

    const rendered = renderTemplateWithCatalogTokens({
      value: picked.payload,
      profile: profileObject,
      context: toRecord(input.context),
      derived: input.derived ?? {},
      tokenBindings: normalizeTokenBindings(content.tokenBindings),
      missingTokenValue,
      missingTokens
    });

    return {
      key: content.key,
      version: content.version,
      templateId: content.templateId,
      locale: picked.locale,
      payload: rendered,
      tags: normalizeTags(content.tags),
      missingTokens: [...missingTokens].sort((a, b) => a.localeCompare(b))
    };
  };

  const resolvePayloadRef = async (input: {
    environment: Environment;
    actionType: string;
    payload: Record<string, unknown>;
    locale?: string;
    profile?: EngineProfile | Record<string, unknown>;
    context?: EngineContext | Record<string, unknown>;
    derived?: Record<string, unknown>;
    now?: Date;
    missingTokenValue?: string;
  }): Promise<{
    payload: Record<string, unknown>;
    tags: string[];
    debug: {
      usedPayloadRef: boolean;
      offer?: { key: string; version: number; valid: boolean };
      content?: { key: string; version: number; locale: string; missingTokens: string[] };
    };
  }> => {
    const payloadRefRaw = input.payload.payloadRef;
    if (!isObject(payloadRefRaw)) {
      return {
        payload: input.payload,
        tags: normalizeTags(input.payload.tags),
        debug: {
          usedPayloadRef: false
        }
      };
    }

    const offerKey = typeof payloadRefRaw.offerKey === "string" && payloadRefRaw.offerKey.trim().length > 0
      ? payloadRefRaw.offerKey.trim()
      : null;
    const contentKey = typeof payloadRefRaw.contentKey === "string" && payloadRefRaw.contentKey.trim().length > 0
      ? payloadRefRaw.contentKey.trim()
      : null;

    const basePayload: Record<string, unknown> = { ...input.payload };
    delete basePayload.payloadRef;

    const resolvedOffer = offerKey
      ? await resolveOffer({
          environment: input.environment,
          offerKey,
          now: input.now
        })
      : null;

    const mergedContext: Record<string, unknown> = {
      ...toRecord(input.context)
    };
    if (resolvedOffer?.valid) {
      mergedContext.offer = resolvedOffer.value;
    }

    const resolvedContent = contentKey
      ? await resolveContent({
          environment: input.environment,
          contentKey,
          locale: input.locale,
          profile: input.profile,
          context: mergedContext,
          derived: input.derived,
          now: input.now,
          missingTokenValue: input.missingTokenValue
        })
      : null;

    if (resolvedContent) {
      if (input.actionType === "message" && isObject(basePayload.payload) && isObject(resolvedContent.payload)) {
        basePayload.payload = {
          ...resolvedContent.payload,
          ...(basePayload.payload as Record<string, unknown>)
        };
      } else {
        basePayload.content = resolvedContent.payload;
      }
    }

    if (resolvedOffer?.valid) {
      basePayload.offer = {
        type: resolvedOffer.type,
        value: resolvedOffer.value,
        constraints: resolvedOffer.constraints,
        key: resolvedOffer.key,
        version: resolvedOffer.version
      };

      if (input.actionType === "message" && isObject(basePayload.payload)) {
        const nested = basePayload.payload as Record<string, unknown>;
        if (!Object.prototype.hasOwnProperty.call(nested, "offer")) {
          basePayload.payload = {
            ...nested,
            offer: resolvedOffer.value
          };
        }
      }
    }

    const tags = [...new Set([
      ...normalizeTags(basePayload.tags),
      ...normalizeTags(resolvedOffer?.tags),
      ...normalizeTags(resolvedContent?.tags)
    ])].sort((a, b) => a.localeCompare(b));

    if (tags.length > 0) {
      basePayload.tags = tags;
    }

    return {
      payload: basePayload,
      tags,
      debug: {
        usedPayloadRef: Boolean(offerKey || contentKey),
        ...(resolvedOffer
          ? {
              offer: {
                key: resolvedOffer.key,
                version: resolvedOffer.version,
                valid: resolvedOffer.valid
              }
            }
          : {}),
        ...(resolvedContent
          ? {
              content: {
                key: resolvedContent.key,
                version: resolvedContent.version,
                locale: resolvedContent.locale,
                missingTokens: resolvedContent.missingTokens
              }
            }
          : {})
      }
    };
  };

  return {
    resolveOffer,
    resolveContent,
    resolvePayloadRef
  };
};
