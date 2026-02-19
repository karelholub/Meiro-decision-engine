export interface AppConfig {
  apiPort: number;
  apiWriteKey?: string;
  protectDecide: boolean;
  meiroMode: "mock" | "real";
  meiroBaseUrl?: string;
  meiroToken?: string;
}

const toBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
};

export const readConfig = (): AppConfig => ({
  apiPort: Number.parseInt(process.env.API_PORT ?? "3001", 10),
  apiWriteKey: process.env.API_WRITE_KEY,
  protectDecide: toBool(process.env.PROTECT_DECIDE, false),
  meiroMode: process.env.MEIRO_MODE === "real" ? "real" : "mock",
  meiroBaseUrl: process.env.MEIRO_BASE_URL,
  meiroToken: process.env.MEIRO_TOKEN
});
