import { readFileSync } from "node:fs";
import { join } from "node:path";
import { runTriage } from "./src/agent/loop";
const c = JSON.parse(readFileSync(join(process.cwd(), "evals/cases/v01-grammarly-responsible-ai.json"), "utf-8"));
(async () => {
  const r = await runTriage({ vendor: c.vendor, urls: c.urls, framework: c.framework });
  console.log(JSON.stringify(r.entry.controls.map((x:any)=>({id:x.control_id,status:x.status})), null, 1));
})();
