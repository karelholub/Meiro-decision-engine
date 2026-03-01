import { DecisioningWebSdk } from "@decisioning/sdk-web";

const sdk = new DecisioningWebSdk({
  baseUrl: "https://api.example.com",
  appKey: "meiro_store",
  environment: "PROD",
  auth: {
    apiKey: "replace-me"
  },
  defaultContext: {
    locale: "en-US",
    deviceType: "web",
    appVersion: "1.0.0"
  }
});

sdk.setProfileId("profile-123");

export const runExample = async (): Promise<void> => {
  const decision = await sdk.decide({
    placement: "home_top"
  });

  if (decision.show) {
    await sdk.trackImpression(decision);
  }
};
