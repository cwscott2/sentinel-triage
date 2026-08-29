import * as cheerio from "cheerio";
import { extractText, getDocumentProxy } from "unpdf";
import { Result, ok, err } from "@/lib/schema";
import type { FetchedPage } from "./fetchPage";

export interface ParsedDoc {
  url: string;
  text: string;
  anchors: { heading: string; offset: number }[];
}

const MIN_USEFUL_CHARS = 200;

export async function parseDocument(page: FetchedPage): Promise<Result<ParsedDoc>> {
  let text = "";
  const anchors: { heading: string; offset: number }[] = [];

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
    $("script, style, nav, footer, header, noscript, svg").remove();

    $("h1, h2, h3").each((_, el) => {
      const heading = $(el).text().trim();
      if (heading) anchors.push({ heading, offset: text.length });
    });

    text = $("main").text() || $("body").text();
    text = text.replace(/\s+/g, " ").trim();
  }

  if (text.trim().length < MIN_USEFUL_CHARS) {
    return err(
      "UNPARSEABLE",
      `No extractable text at ${page.url} (${text.trim().length} chars).`,
      "This document yields no machine-readable text. Do not infer its contents. Mark affected controls no_evidence."
    );
  }

  return ok({ url: page.url, text, anchors });
}
