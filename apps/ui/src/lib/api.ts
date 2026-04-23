import { catalogApiClient } from "./api-catalog";
import { decisioningApiClient } from "./api-decisioning";
import { inAppApiClient } from "./api-inapp";
import { meiroApiClient } from "./api-meiro";
import { operationsApiClient } from "./api-operations";

export { ApiError, USER_EMAIL_STORAGE_KEY, apiFetch, apiFetchText, setApiUserEmail, toQuery } from "./api-core";
export type * from "./api-types";
export { catalogApiClient, decisioningApiClient, inAppApiClient, meiroApiClient, operationsApiClient };

export const apiClient = {
  ...operationsApiClient,
  ...decisioningApiClient,
  catalog: catalogApiClient,
  ...inAppApiClient,
  ...meiroApiClient
};
