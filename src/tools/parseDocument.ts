import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { Result, ok, err } from "@/lib/schema";
import type { FetchedPage } from "./fetchPage";
import {
  HIDDEN_STYLE,
  sanitizeUntrustedText,
  scanForInjection,
  type InjectionFinding,
} from "@/guardrails/injection";

export interface ParsedDoc {
  url: string;
  text: string;
  anchors: { heading: string; offset: number }[];
  /**
   * Passages removed from `text` because they instruct an AI rather than
   * describe the vendor. Empty for an ordinary page. `text` never contains
   * them, so they reach neither the extraction model nor verify_citation.
   */
  injection: InjectionFinding[];
}

const MIN_USEFUL_CHARS = 200;

export async function parseDocument(page: FetchedPage): Promise<Result<ParsedDoc>> {
  let text = "";
  const anchors: { heading: string; offset: number }[] = [];
  const injection: InjectionFinding[] = [];

  if (page.contentType.includes("pdf") && page.body instanceof ArrayBuffer) {
    try {
      const pdf = await getDocumentProxy(new Uint8Array(page.body));
      const { text: pdfText } = await extractText(pdf, { mergePages: true });
      text = String(pdfText);
    } catch {
      // Image-only / scanned PDFs land here. This is a DESIGNED abstention case.
      return err(
        "UNPARSEABLE",
        `PDF at ${page.url} yielded no extractable text.`,
        "This document is scanned or image-only. Do not infer its contents. Mark affected controls no_evidence."
      );
    }
  } else if (typeof page.body === "string") {
    const $ = cheerio.load(page.body);
    $("script, style, nav, footer, header, noscript, svg, template").remove();

    // Text a human reader cannot see is not vendor disclosure, and it is the
    // cheapest place to plant an instruction. cheerio's .text() includes it, so
    // it is removed here. Hidden elements are common and usually innocent
    // (menus, dialogs), so presence alone is not flagged: only hidden text that
    // itself trips an injection rule is reported.
    $("[hidden], [style]").each((_, el) => {
      const node = $(el);
      const hidden = node.attr("hidden") !== undefined || HIDDEN_STYLE.test(node.attr("style") ?? "");
      if (!hidden) return;
      for (const f of scanForInjection(node.text())) {
        injection.push({ rule: `hidden_text:${f.rule}`, excerpt: f.excerpt });
      }
      node.remove();
    });

    // Block elements must be separated before extraction. cheerio's .text()
    // concatenates without whitespace, producing "...for all users.In addition"
    // — which breaks sentence splitting AND causes verify_citation to reject
    // otherwise-valid quotes that span a block boundary. Found via the labeling
    // worksheets on 2026-08-29.
    $("p, div, li, br, tr, section, article, h1, h2, h3, h4, h5, h6").after(" ");

    $("h1, h2, h3").each((_, el) => {
      const heading = $(el).text().trim();
      // Headings are returned to the judgment model, so they pass the same scan.
      if (heading && scanForInjection(heading).length === 0) {
        anchors.push({ heading, offset: text.length });
      }
    });

    text = $("main").text() || $("body").text();
    text = text.replace(/\s+/g, " ").trim();
  }

  // Input guardrail. Runs on every document, HTML or PDF, before the length
  // check: a page that is nothing but an injected instruction should come out
  // as unparseable, not as a source.
  const clean = sanitizeUntrustedText(text);
  text = clean.text;
  injection.push(...clean.findings);

  if (text.trim().length < MIN_USEFUL_CHARS) {
    return err(
      "UNPARSEABLE",
      `No extractable text at ${page.url} (${text.trim().length} chars).`,
      "This document yields no machine-readable text. Do not infer its contents. Mark affected controls no_evidence."
    );
  }

  return ok({ url: page.url, text, anchors, injection });
}
