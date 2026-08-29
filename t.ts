import { fetchPage } from "./src/tools/fetchPage";
import { parseDocument } from "./src/tools/parseDocument";
const urls = [
  "https://help.asana.com/s/article/asana-ai-faq?language=en_US",
  "https://www.figma.com/legal/ai-terms/",
  "https://www.grammarly.com/ai/responsible-ai",
];
(async () => {
  for (const u of urls) {
    let t = Date.now();
    const f = await fetchPage(u);
    const ft = Date.now() - t;
    if (!f.ok) { console.log(`${ft}ms fetch FAIL ${f.code}  ${u}`); continue; }
    const bytes = typeof f.value.body === "string" ? f.value.body.length : f.value.body.byteLength;
    t = Date.now();
    const p = await parseDocument(f.value);
    console.log(`fetch=${ft}ms parse=${Date.now()-t}ms bytes=${bytes.toLocaleString()} ${p.ok ? "text="+p.value.text.length.toLocaleString() : "FAIL "+p.code}  ${u.slice(0,50)}`);
  }
})();
