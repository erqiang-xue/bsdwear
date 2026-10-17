import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { createApp } from "./app.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config(); // also allow server/.env override

const port = Number(process.env.PORT) || 3001;
const app = createApp();
app.listen(port, () => {
  console.log(`server listening on http://localhost:${port}`);
});
