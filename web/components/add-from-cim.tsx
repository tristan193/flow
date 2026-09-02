"use client";

import { useRouter } from "next/navigation";
import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState } from "react";

type Draft = {
  title: string;
  blurb: string | null;
  city: string | null;
  state: string | null;
  revenue: number | null;
  ebitda: number | null;
  sde: number | null;
  asking: number | null;
  businessModelType: string | null;
  url: string | null;
  uncertainty: string | null;
};

type FormState = {
  title: string;
  blurb: string;
  city: string;
  state: string;
  revenue: string;
  ebitda: string;
  sde: string;
  asking: string;
  businessModelType: string;
  url: string;
};

const EMPTY: FormState = {
  title: "",
  blurb: "",
  city: "",
  state: "",
  revenue: "",
  ebitda: "",
  sde: "",
  asking: "",
  businessModelType: "",
  url: "",
};

function moneyToInput(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "";
  return String(Math.round(n));
}

function draftToForm(d: Draft): FormState {
  return {
    title: d.title || "",
    blurb: d.blurb || "",
    city: d.city || "",
    state: d.state || "",
    revenue: moneyToInput(d.revenue),
    ebitda: moneyToInput(d.ebitda),
    sde: moneyToInput(d.sde),
    asking: moneyToInput(d.asking),
    businessModelType: d.businessModelType || "",
    url: d.url || "",
  };
}

/**
 * Pipeline entry: upload a CIM PDF → LLM extracts fields → review → deal @ stage CIM.
 */
export function AddFromCim({
  extractPath = "/api/cim/extract",
  createPath = "/api/cim/create",
}: {
  extractPath?: string;
  createPath?: string;
}) {
  const router = useRouter();
  const titleId = useId();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<"pick" | "review">("pick");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [uncertainty, setUncertainty] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  function reset() {
    setStep("pick");
    setFile(null);
    setForm(EMPTY);
    setUncertainty(null);
    setError(null);
    setBusy(false);
    if (fileRef.current) fileRef.current.value = "";
  }

  function close() {
    if (busy) return;
    setOpen(false);
    reset();
  }

  async function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const next = event.target.files?.[0];
    if (!next) return;

    setBusy(true);
    setError(null);
    setFile(next);
    try {
      const body = new FormData();
      body.append("file", next);
      const response = await fetch(extractPath, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not read that CIM.");
      const draft = data.draft as Draft;
      setForm(draftToForm(draft));
      setUncertainty(draft.uncertainty || null);
      setStep("review");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extract failed.");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
    } finally {
      setBusy(false);
    }
  }

  async function onCreate() {
    if (!form.title.trim()) {
      setError("Title is required.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.append("title", form.title.trim());
      body.append("blurb", form.blurb.trim());
      body.append("city", form.city.trim());
      body.append("state", form.state.trim());
      body.append("revenue", form.revenue.trim());
      body.append("ebitda", form.ebitda.trim());
      body.append("sde", form.sde.trim());
      body.append("asking", form.asking.trim());
      body.append("businessModelType", form.businessModelType.trim());
      body.append("url", form.url.trim());
      if (file) body.append("file", file);

      const response = await fetch(createPath, { method: "POST", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Could not create deal.");
      setOpen(false);
      reset();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed.");
    } finally {
      setBusy(false);
    }
  }

  function field(
    key: keyof FormState,
    label: string,
    opts: { multiline?: boolean; placeholder?: string } = {},
  ) {
    const common =
      "border-line bg-surface-raised text-ink mt-1 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:border-ink/30";
    return (
      <label className="block">
        <span className="text-ink-faint text-[11.5px] font-medium">{label}</span>
        {opts.multiline ? (
          <textarea
            rows={3}
            value={form[key]}
            disabled={busy}
            placeholder={opts.placeholder}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={`${common} resize-y`}
          />
        ) : (
          <input
            type="text"
            value={form[key]}
            disabled={busy}
            placeholder={opts.placeholder}
            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
            className={common}
          />
        )}
      </label>
    );
  }

  const panel =
    open && mounted
      ? createPortal(
          <div
            className="fixed inset-0 z-[80] flex items-end justify-center sm:items-center sm:p-4"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
          >
            <button
              type="button"
              aria-label="Close"
              className="absolute inset-0 bg-black/55"
              onClick={close}
            />
            <div className="border-line bg-surface relative z-[1] flex max-h-[88vh] w-full flex-col rounded-t-2xl border sm:max-w-lg sm:rounded-xl">
              <div className="border-line flex shrink-0 items-start justify-between gap-3 border-b px-4 py-3">
                <div>
                  <p id={titleId} className="text-[14px] font-semibold">
                    Add from CIM
                  </p>
                  <p className="text-ink-faint mt-0.5 text-[11.5px] leading-snug">
                    {step === "pick"
                      ? "Upload a PDF — we’ll pull title, money, and a short blurb."
                      : "Review the extract, then land it on the board at CIM."}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={close}
                  className="text-ink-faint hover:text-ink shrink-0 px-1 text-[18px] leading-none disabled:opacity-50"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3">
                {step === "pick" ? (
                  <div className="space-y-3">
                    <input
                      ref={fileRef}
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={busy}
                      onChange={onPick}
                      className="text-ink-dim block w-full text-[12.5px] file:border-line file:bg-surface-raised file:text-ink file:mr-3 file:rounded-lg file:border file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold"
                    />
                    <p className="text-ink-faint text-[12px] leading-relaxed">
                      Max 4MB. Text-based PDFs work best; heavy scans may need a later OCR pass.
                    </p>
                    {busy && (
                      <p className="text-ink-dim text-[12.5px]">Reading CIM with AI…</p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    {uncertainty && (
                      <p className="bg-flag-bg text-flag rounded-lg px-3 py-2 text-[12px] leading-snug">
                        Check: {uncertainty}
                      </p>
                    )}
                    {field("title", "Title")}
                    {field("blurb", "Summary", { multiline: true })}
                    <div className="grid grid-cols-2 gap-3">
                      {field("city", "City")}
                      {field("state", "State")}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {field("revenue", "Revenue ($)", { placeholder: "350000" })}
                      {field("asking", "Asking ($)", { placeholder: "1200000" })}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {field("ebitda", "EBITDA ($)")}
                      {field("sde", "SDE / cash flow ($)")}
                    </div>
                    {field("businessModelType", "Business model", {
                      placeholder: "LOCAL_SERVICE / LOCATION_AGNOSTIC / …",
                    })}
                    {field("url", "Listing URL (optional)")}
                    {file && (
                      <p className="text-ink-faint text-[11.5px]">
                        Attaching: <span className="text-ink">{file.name}</span>
                      </p>
                    )}
                  </div>
                )}

                {error && (
                  <p className="bg-pass-bg text-pass mt-3 rounded-lg px-3 py-2 text-[12.5px]">
                    {error}
                  </p>
                )}
              </div>

              {step === "review" && (
                <div className="border-line flex shrink-0 gap-2 border-t px-4 py-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setStep("pick");
                      setFile(null);
                      setForm(EMPTY);
                      setUncertainty(null);
                      setError(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                    className="border-line text-ink-dim hover:bg-surface-raised flex-1 rounded-lg border px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
                  >
                    Different file
                  </button>
                  <button
                    type="button"
                    disabled={busy || !form.title.trim()}
                    onClick={onCreate}
                    className="bg-ink text-surface flex-1 rounded-lg px-3 py-2 text-[13px] font-semibold disabled:opacity-50"
                  >
                    {busy ? "Adding…" : "Add to pipeline"}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="border-line bg-surface-raised text-ink hover:bg-surface rounded-lg border px-3 py-1.5 text-[12.5px] font-semibold"
      >
        Add from CIM
      </button>
      {panel}
    </>
  );
}
