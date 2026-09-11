import "./loadEnv.js";
import { createApp } from "./http/app.js";
import { env } from "./config.js";

createApp().listen(env.PORT, () => {
  console.log(`Amanah API on http://localhost:${env.PORT}`);
});
