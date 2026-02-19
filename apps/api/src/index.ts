import { buildApp } from "./app";
import { readConfig } from "./config";

const start = async () => {
  const config = readConfig();
  const app = await buildApp({ config });

  try {
    await app.listen({
      host: "0.0.0.0",
      port: config.apiPort
    });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

start();
