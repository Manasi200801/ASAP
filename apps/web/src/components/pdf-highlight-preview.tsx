"use client";

import { useEffect, useRef, useState } from "react";
import { DocumentIcon } from "./icons";
import { Spinner } from "./spinner";

/** One rendered page: the real text pdf.js found on it, and the DOM node each
 * string renders into, already positioned correctly by pdf.js itself. */
type TextIndex = { divs: HTMLElement[]; strings: string[] };

function normalize(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.replace(/\s+/g, " ").trim().toLowerCase();
  return trimmed || null;
}

/**
 * Renders a PDF page to canvas, plus pdf.js's own text layer on top of it, and
 * can highlight whichever of that *real* text matches `highlightQuery`.
 *
 * There is no bounding-box data anywhere in this system - extraction returns
 * field values and a confidence score, never a page position - so a highlight
 * only ever exists where the field's extracted value was actually found as
 * text on the rendered page. A field whose value does not appear verbatim (a
 * reformatted number, a translated label) highlights nothing rather than
 * guessing at a position. Exact matches are preferred over substring ones,
 * which is what keeps a short value like a tax code from lighting up every
 * unrelated number that happens to contain the same digits.
 */
export function PdfHighlightPreview({
  url,
  fileName,
  highlightQuery,
}: {
  url: string;
  fileName: string;
  highlightQuery: string | null;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stackRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const index = useRef<TextIndex>({ divs: [], strings: [] });
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  // Deliberately keyed on `url` alone: `applyHighlight` is read here only to
  // seed the very first render, and re-running the whole page render (canvas +
  // text layer) on every hover would defeat the point of the cheap highlight
  // toggle in the effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies: see above
  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    index.current = { divs: [], strings: [] };

    async function render() {
      const wrapper = wrapperRef.current;
      const stack = stackRef.current;
      const canvas = canvasRef.current;
      const textLayerEl = textLayerRef.current;
      if (!wrapper || !stack || !canvas || !textLayerEl) return;

      try {
        const pdfjsLib = await import("pdfjs-dist");
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url,
        ).toString();

        const doc = await pdfjsLib.getDocument(url).promise;
        // Every invoice this app deals with is one page; a second page (or a
        // cover sheet) would simply never be shown, not silently truncated -
        // there is nowhere in the UI that promises "the whole document" today.
        const page = await doc.getPage(1);
        if (cancelled) return;

        // Fit the page to the pane's own width rather than a fixed scale, so a
        // narrow sidebar and a maximised window both render legibly instead of
        // clipped or tiny.
        const unscaled = page.getViewport({ scale: 1 });
        const width = wrapper.clientWidth || unscaled.width;
        const viewport = page.getViewport({ scale: width / unscaled.width });

        stack.style.width = `${viewport.width}px`;
        stack.style.height = `${viewport.height}px`;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        textLayerEl.style.setProperty("--total-scale-factor", `${viewport.scale}`);

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas is not supported.");
        await page.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        textLayerEl.replaceChildren();
        const textContent = await page.getTextContent();
        const textLayer = new pdfjsLib.TextLayer({
          textContentSource: textContent,
          container: textLayerEl,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        index.current = {
          divs: textLayer.textDivs as HTMLElement[],
          strings: textLayer.textContentItemsStr,
        };
        applyHighlight(highlightQuery);
        setStatus("ready");
      } catch (error) {
        if (!cancelled) {
          log(error);
          setStatus("error");
        }
      }
    }

    render();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    applyHighlight(highlightQuery);
  }, [highlightQuery]);

  function applyHighlight(query: string | null) {
    const { divs, strings } = index.current;
    const needle = normalize(query);
    if (needle === null) {
      for (const div of divs) div.classList.remove("pdf-highlight");
      return;
    }

    // Exact match first - a tax code like "V1" or a company code like "1010"
    // would otherwise light up as a substring of half the numbers on the page.
    // Only when nothing matches exactly (the PDF's own layout can split one
    // value across two spans) does a longer value fall back to a substring
    // match, and short ones simply stay unhighlighted rather than risk it.
    const exact = strings.map((s) => normalize(s) === needle);
    const anyExact = exact.includes(true);
    for (let i = 0; i < divs.length; i++) {
      const hit = anyExact
        ? exact[i]
        : needle.length >= 4 && (normalize(strings[i])?.includes(needle) ?? false);
      divs[i].classList.toggle("pdf-highlight", hit);
    }
  }

  return (
    <div ref={wrapperRef} className="relative h-full w-full overflow-auto">
      <div ref={stackRef} className="relative mx-auto">
        <canvas ref={canvasRef} className="block" aria-label={fileName} />
        <div ref={textLayerRef} className="pdf-text-layer" />
      </div>

      {status !== "ready" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-surface px-6 py-10 text-center">
          {status === "loading" ? (
            <Spinner className="h-5 w-5 text-on-surface-faint" />
          ) : (
            <>
              <DocumentIcon className="h-8 w-8 text-on-surface-faint" />
              <span className="text-[13px] text-on-surface-faint">{fileName}</span>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function log(error: unknown) {
  console.error("PDF preview failed to render", error);
}
