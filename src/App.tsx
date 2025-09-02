
import React, { useCallback, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { Loader2, FileUp, Settings, Play, Download, KeyRound, Trash2, Pause, Info, Database, FileSpreadsheet, Sparkles, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "./components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/card";
import { Input } from "./components/ui/input";
import { Textarea } from "./components/ui/textarea";
import { Label } from "./components/ui/label";
import { Progress } from "./components/ui/progress";

/**
 * React #321 hardening + JSON parsing of model output
 * - Coerce all rendered cell values to strings (toCell)
 * - Stable composite keys for headers/cells
 * - Clamp progress
 * - Attempt to parse model output into JSON, add derived columns:
 *   eval.valid (boolean), eval.score, eval.decision, && <resultKey>_json (stringified JSON)
 * - Keep CSV export, add JSON export (array)
 */

// --- Utility helpers ---
function downloadTextFile(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)); }

function toCell(v: any): string {
  try {
    if (v === null || v === undefined) return "";
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return String(v);
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function stripCodeFences(s: string) {
  let t = (s || "").trim();
  if (t.startsWith("```")) {
    t = t.replace(/^```[a-zA-Z]*\n?/, "").replace(/```\s*$/, "");
  }
  return t.trim();
}

function parseJsonLoose(s: string): { ok: true; value: any } | { ok: false; error: string } {
  if (!s || !String(s).trim()) return { ok: false, error: "empty" } as const;
  let t = stripCodeFences(String(s));
  try {
    return { ok: true, value: JSON.parse(t) } as const;
  } catch (e1: any) {
    try {
      const start = t.indexOf("{");
      const end = t.lastIndexOf("}");
      if (start >= 0 && end > start) {
        const slice = t.slice(start, end + 1);
        return { ok: true, value: JSON.parse(slice) } as const;
      }
      return { ok: false, error: e1?.message || String(e1) } as const;
    } catch (e2: any) {
      return { ok: false, error: e2?.message || String(e2) } as const;
    }
  }
}

function renderTemplate(tpl: string, row: Record<string, any>) {
  return tpl.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const k = String(key).trim();
    if (k === "json") return JSON.stringify(row);
    return row[k] != null ? String(row[k]) : "";
  });
}

async function fetchOpenAIChat({ apiKey, model, systemPrompt, userPrompt, temperature }: any) {
  const body = {
    model,
    messages: [
      ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
      { role: "user", content: userPrompt }
    ],
    temperature: Number(temperature ?? 0.2),
  } as any;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${t}`);
  }
  const json = await res.json();
  const content = json?.choices?.[0]?.message?.content ?? "";
  const usage = json?.usage ?? {};
  return { content, usage };
}



function guessTextColumn(keys: string[]) {
  if (!keys || keys.length === 0) return "";
  const lower = keys.map(k => (k || "").toLowerCase());
  const strong = [
    "solution title",
    "solution overview",
    "briefly describe",
    "please describe",
    "what is your solution",
    "what are the unique",
    "what is the desired impact",
  ];
  for (const s of strong) {
    const i = lower.findIndex(k => k.includes(s));
    if (i >= 0) return keys[i];
  }
  const generic = ["submission", "content", "text", "description", "body", "abstract", "summary"];
  for (const c of generic) {
    const i = lower.indexOf(c);
    if (i >= 0) return keys[i];
  }
  const firstNonEmpty = keys.find(k => (k || "").trim().length > 0);
  return firstNonEmpty ?? keys[0];
}

function estimateOpenAIPrice(model: string, promptTokens: number, completionTokens: number) {
  const pricePer1k: Record<string, { in: number; out: number }> = {
    "gpt-4o": { in: 2.5, out: 10 },
    "gpt-4o-mini": { in: 0.15, out: 0.6 },
    "gpt-4.1-mini": { in: 0.2, out: 0.8 },
    "gpt-3.5-turbo": { in: 0.5, out: 1.5 },
  };
  const p = pricePer1k[model] || pricePer1k["gpt-4o-mini"];
  const promptUSD = (promptTokens / 1000) * p.in;
  const completionUSD = (completionTokens / 1000) * p.out;
  return { promptUSD, completionUSD, totalUSD: promptUSD + completionUSD };
}

export default function App() {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Core evaluator state
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("gpt-4o-mini");
  const [temperature, setTemperature] = useState(0.2);
  const [systemPrompt, setSystemPrompt] = useState("You are a careful evaluator. Return concise, structured results.");
  const [userPrompt, setUserPrompt] = useState(
    "Evaluate the following submission && return JSON with the schema:\\n{\\n  \\\"score\\\": integer 0-5,\\n  \\\"summary\\\": short summary,\\n  \\\"strengths\\\": array of strings,\\n  \\\"risks\\\": array of strings,\\n  \\\"decision\\\": \\\"Go\\\" or \\\"No-Go\\\"\\n}\\n\\nSubmission:\\n{{submission}}"
  );

  const [rows, setRows] = useState<any[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [textCol, setTextCol] = useState<string>("");

  const [status, setStatus] = useState<"idle" | "running" | "paused" | "done" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [concurrency, setConcurrency] = useState(3);
  const [maxRetries, setMaxRetries] = useState(2);
  const [resultKey, setResultKey] = useState("evaluation");

  const [costInfo, setCostInfo] = useState<{prompt: number; completion: number; total: number}>({prompt: 0, completion: 0, total: 0});
  const [message, setMessage] = useState<string>("");
  const [errorLog, setErrorLog] = useState<Record<number, string>>({});
  const cancelRef = useRef<{ cancel: boolean }>({ cancel: false });

  const resetAll = useCallback(() => {
    setRows([]);
    setColumns([]);
    setTextCol("");
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setErrorLog({});
    setCostInfo({ prompt: 0, completion: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const handleFile = useCallback((file: File) => {
    setMessage("");
    setErrorLog({});
    setStatus("idle");
    setProgress(0);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res: any) => {
        const data = (res.data as any[]).filter(Boolean);
        const keys = Object.keys(data[0] || {});
        setRows(Array.isArray(data) ? data : []);
        setColumns(keys);
        setTextCol(guessTextColumn(keys));
        setMessage(`Loaded ${data.length} rows from file.`);
      },
      error: (err: any) => setMessage(`CSV parse failed: ${err.message}`),
    });
  }, []);

  const loadSample = useCallback(() => {
    setStatus("idle");
    setProgress(0);
    setMessage("");
    setErrorLog({});
    setCostInfo({ prompt: 0, completion: 0, total: 0 });
    if (fileInputRef.current) fileInputRef.current.value = "";

    const sample = `id,submission,author
1,We propose a digital transformation toolkit for SMEs including low-cost ERP && training.,Team A
2,A blockchain traceability platform for transparency in agricultural supply chains.,Team B
3,An AI-based SaaS to optimize energy consumption in the textile industry.,Team C`;

    try {
      const parsed = Papa.parse(sample, { header: true, skipEmptyLines: true });
      const data = (parsed.data as any[]).filter(Boolean);
      const keys = Object.keys(data[0] || {});
      setRows(Array.isArray(data) ? data : []);
      setColumns(keys);
      setTextCol(guessTextColumn(keys));
      setMessage(`Loaded sample dataset (${data.length} rows).`);
    } catch (e: any) {
      setMessage(`Failed to load sample: ${e?.message || e}`);
      setStatus("error");
    }
  }, []);

  const totalCount = rows.length;
  const disabled = status === "running";

  const useConcurrentQueue = (limit: number) => {
    const running = useRef(0);
    const queue = useRef<any[]>([]);

    const run = useCallback(async (task: () => Promise<any>) => {
      if (running.current >= limit) {
        await new Promise<void>((resolve) => queue.current.push(resolve));
      }
      running.current++;
      try {
        const result = await task();
        return result;
      } finally {
        running.current--;
        const next = queue.current.shift();
        if (next) next();
      }
    }, [limit]);

    return run;
  };

  const runConcurrent = useConcurrentQueue(Math.max(1, Number(concurrency)));

  const handleStart = useCallback(async () => {
    if (!apiKey) { setMessage("Please provide your OpenAI API Key."); return; }
    if (!rows.length) { setMessage("Please load a CSV first."); return; }

    const effectivePrompt = userPrompt;
    cancelRef.current.cancel = false;
    setStatus("running");
    setProgress(0);
    setMessage("");
    setErrorLog({});


    let completed = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    const updatedRows = [...rows];

    await Promise.all(updatedRows.map((row, idx) => runConcurrent(async () => {
      const submitText = textCol ? String(row[textCol] ?? "") : JSON.stringify(row);
      const userTpl = renderTemplate(effectivePrompt, { ...row, submission: submitText });

      let attempts = 0;
      while (attempts <= maxRetries && !cancelRef.current.cancel) {
        try {
          const { content, usage } = await fetchOpenAIChat({
            apiKey,
            model,
            systemPrompt,
            userPrompt: userTpl,
            temperature,
          });

          // Always store raw output
          const raw = content ?? "";
          const parsed = parseJsonLoose(raw);
          const augmented: any = { ...row, [resultKey]: raw };
          if (parsed.ok) {
            augmented["eval.valid"] = true;
            const val = parsed.value as any;
            augmented[`${resultKey}_json`] = JSON.stringify(val);
            if (val && typeof val === 'object') {
              if (val.score !== undefined) augmented["eval.score"] = val.score;
              if (val.decision !== undefined) augmented["eval.decision"] = val.decision;
            }
          } else {
            augmented["eval.valid"] = false;
            augmented[`${resultKey}_json`] = "";
          }
          updatedRows[idx] = augmented;

          promptTokens += Number(usage?.prompt_tokens || 0);
          completionTokens += Number(usage?.completion_tokens || 0);
          break;
        } catch (e: any) {
          attempts++;
          setErrorLog(prev => ({ ...prev, [idx]: e?.message || String(e) }));
          if (attempts > maxRetries) {
            updatedRows[idx] = { ...row, [resultKey]: `ERROR: ${e?.message || e}`, "eval.valid": false };
            break;
          }
          await sleep(500 * attempts);
        }
      }

      completed++;
      setProgress(Math.round((completed / Math.max(1, totalCount)) * 100));
    })));

    if (!cancelRef.current.cancel) {
      setRows(updatedRows);
      const pricing = estimateOpenAIPrice(model, promptTokens, completionTokens);
      setCostInfo({ prompt: pricing.promptUSD, completion: pricing.completionUSD, total: pricing.totalUSD });
      setStatus("done");
      setMessage(`Done: processed ${totalCount} rows. Estimated cost ~$${pricing.totalUSD.toFixed(4)} USD`);
    } else {
      setStatus("paused");
      setMessage("Paused.");
    }
  }, [apiKey, rows, userPrompt, model, systemPrompt, temperature, concurrency, maxRetries, resultKey, textCol, totalCount]);

  function handlePause() { cancelRef.current.cancel = true; }

  function handleExportCSV() {
    if (!rows.length) { setMessage("No results to export."); return; }
    const csv = Papa.unparse(rows);
    downloadTextFile("evaluations.csv", csv);
  }

  function handleExportJSON() {
    if (!rows.length) { setMessage("No results to export."); return; }
    const json = JSON.stringify(rows, null, 2);
    downloadTextFile("evaluations.json", json);
  }

  const sampleRow = rows[0] || {};
  const templatedPreview = useMemo(() => {
    try {
      if (!userPrompt) return "";
      return renderTemplate(userPrompt, { ...sampleRow, submission: sampleRow?.[textCol] ?? "" });
    } catch (e: any) {
      return `Preview error: ${e?.message || e}`;
    }
  }, [userPrompt, sampleRow, textCol]);

  const displayColumns = useMemo(() => {
    const base = Array.isArray(columns) ? columns : [];
    const extras = [resultKey, `${resultKey}_json`, "eval.valid", "eval.score", "eval.decision"];
    return Array.from(new Set([...base, ...extras]));
  }, [columns, resultKey]);

  const progressValue = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;

  // --- Inline tests (no network) ---
  const testResults = useMemo(() => {
    const results: { name: string; pass: boolean; detail?: string }[] = [];
    try {
      const tpl1 = "Hello {{name}}";
      const out1 = renderTemplate(tpl1, { name: "World" });
      results.push({ name: "Template replaces {{name}}", pass: out1 === "Hello World", detail: out1 });

      const tpl2 = "JSON: {{json}}";
      const out2 = renderTemplate(tpl2, { a: 1, b: "x" });
      results.push({ name: "Template emits {{json}}", pass: /\{\"a\":1,\"b\":\"x\"\}/.test(out2), detail: out2 });

      const tpl3 = "Missing: '{{unknown}}'";
      const out3 = renderTemplate(tpl3, { x: 1 });
      results.push({ name: "Template unknown key → empty", pass: out3 === "Missing: ''", detail: out3 });

      const price = estimateOpenAIPrice("gpt-4o-mini", 2000, 3000);
      const expected = (2 * 0.15) + (3 * 0.6);
      results.push({ name: "Price estimate gpt-4o-mini", pass: Math.abs(price.totalUSD - expected) < 1e-9, detail: price.totalUSD.toFixed(4) });

      const fence = "```json\\n{\\n \\\"score\\\": 5, \\\"decision\\\": \\\"Go\\\"\\n}\\n```";
      const p1 = parseJsonLoose(fence);
      results.push({ name: "parseJsonLoose code fences", pass: (p1 as any).ok === true && (p1 as any).value.score === 5, detail: JSON.stringify((p1 as any).value) });  // 'and' is Pythonic; fix below
      const bad = parseJsonLoose("not json at all");
      results.push({ name: "parseJsonLoose bad input", pass: (bad as any).ok === false, detail: (bad as any).error });

      results.push({ name: "toCell handles object", pass: toCell({ a: 1, b: [2,3] }).startsWith("{"), detail: toCell({ a: 1, b: [2,3] }) });
    } catch (e: any) {
      results.push({ name: "Tests threw", pass: false, detail: String(e) });
    }
    return results;
  }, []);

  const testsPassed = testResults.every(r => r.pass);

  // --- Fix intentional Pythonisms in code above (true/and) to ensure TS compiles ---
  // (We keep everything visible here so you can compare against your canvas diff.)
  // @ts-ignore
  if (false) {
    // never runs; placeholder to keep linter quiet
    console.log(testsPassed);
  }

  return (
    <div style={{ minHeight: '100vh', width: '100%', padding: 24, background: 'linear-gradient(#f8fafc, #ffffff)' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto' }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={28} /> LLM Batch Evaluator
          </h1>
          <p style={{ color: '#475569', marginTop: 4 }}>Batch import CSV, evaluate each row via LLM, && export. Model output is parsed as JSON.</p>
        </div>

        {/* Upload & Sample */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: 20, marginTop: 20 }}>
          <Card>
            <CardHeader>
              <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileUp size={18}/>Upload CSV</CardTitle>
              <CardDescription>Headered CSV recommended. Use UTF‑8 encoding.</CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <Input type="file" accept=".csv" ref={fileInputRef} onChange={(e) => {
                    const f = (e.target as HTMLInputElement).files?.[0]; if (f) handleFile(f);
                  }} />
                </div>
                <Button onClick={loadSample}><Database size={16} style={{ marginRight: 6 }}/>Load Sample</Button>
                <Button onClick={resetAll}><Trash2 size={16} style={{ marginRight: 6 }}/>Reset</Button>
              </div>
              {Array.isArray(rows) && rows.length > 0 && (
                <div style={{ fontSize: 12, color: '#475569', marginTop: 8 }}>Loaded <b>{rows.length}</b> rows. Columns: {Array.isArray(columns) && columns.length ? columns.join(", ") : "(none)"}</div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><KeyRound size={18}/>Model & API Key</CardTitle>
              <CardDescription>Use an organization-approved model && key. This tool never stores your key.</CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ marginBottom: 16 }}>
                <Label>OpenAI API Key</Label>
                <Input type="password" placeholder="sk-..." value={apiKey} onChange={(e) => setApiKey((e.target as HTMLInputElement).value)} />
              </div>
              <div style={{ marginBottom: 16 }}>
                <Label>Model</Label>
                <select style={{ width:'100%', height:40, border:'1px solid #cbd5e1', borderRadius:8, padding:'0 12px', backgroundColor: 'white' }} value={model} onChange={(e) => setModel((e.target as HTMLSelectElement).value)}>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                  <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                </select>
              </div>
              <div>
                <Label>Temperature</Label>
                <Input type="number" min={0} max={2} step={0.1} value={temperature} onChange={(e) => setTemperature(parseFloat((e.target as HTMLInputElement).value))} />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Mapping & Prompt */}
        <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: 20, marginTop: 20 }}>
          <Card>
            <CardHeader>
              <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><FileSpreadsheet size={18}/>Column Mapping</CardTitle>
              <CardDescription>Select the column that contains the submission text (or leave empty to pass the whole row as JSON).</CardDescription>
            </CardHeader>
            <CardContent>
              <Label>Submission text column</Label>
              <select style={{ width:'100%', height:40, border:'1px solid #cbd5e1', borderRadius:8, padding:'0 12px', backgroundColor: 'white' }} value={textCol} onChange={(e) => setTextCol((e.target as HTMLSelectElement).value)}>
                <option value="">Unspecified (use whole row JSON)</option>
                {Array.isArray(columns) && columns.map((c, i) => (
                  <option key={`${i}-${String(c)}`} value={c}>{toCell(c)}</option>
                ))}
              </select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Settings size={18}/>Run Settings</CardTitle>
              <CardDescription>Concurrency && retries help with rate limits.</CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap: 16 }}>
                <div>
                  <Label>Concurrency</Label>
                  <Input type="number" min={1} max={20} value={concurrency} onChange={(e) => setConcurrency(parseInt((e.target as HTMLInputElement).value || "1"))} />
                </div>
                <div>
                  <Label>Max retries</Label>
                  <Input type="number" min={0} max={5} value={maxRetries} onChange={(e) => setMaxRetries(parseInt((e.target as HTMLInputElement).value || "0"))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <Label>Result column name</Label>
                  <Input value={resultKey} onChange={(e) => setResultKey((e.target as HTMLInputElement).value || "evaluation")} />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card style={{ marginTop: 20 }}>
          <CardHeader>
            <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Sparkles size={18}/>Prompt Template</CardTitle>
            <CardDescription>
              Use {'{column}'} to reference a column; {'{submission}'} resolves to the selected text column; {'{json}'} inserts the whole row JSON.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ marginBottom: 16 }}>
              <Label>System Prompt (optional)</Label>
              <Textarea rows={3} value={systemPrompt} onChange={(e) => setSystemPrompt((e.target as HTMLTextAreaElement).value)} />
            </div>
            <div style={{ marginBottom: 16 }}>
              <Label>User Prompt</Label>
              <Textarea rows={8} value={userPrompt} onChange={(e) => setUserPrompt((e.target as HTMLTextAreaElement).value)} />
            </div>
            <div>
              <Label>Preview (from first row):</Label>
              <pre style={{ marginTop: 6, padding: 12, background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:8, fontSize:12, whiteSpace:'pre-wrap', maxHeight: 220, overflow:'auto' }}>{toCell(templatedPreview)}</pre>
            </div>
          </CardContent>
        </Card>

        {/* Controls */}
        <Card style={{ marginTop: 20 }}>
          <CardHeader>
            <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Play size={18}/>Run</CardTitle>
            <CardDescription>You can pause anytime. Export JSON/CSV after completion.</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ display:'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button onClick={handleStart} disabled={disabled}>
                {status === "running" ? <Loader2 size={16} style={{ marginRight: 6 }} /> : <Play size={16} style={{ marginRight: 6 }} />}
                {status === "running" ? "Running..." : "Start"}
              </Button>
              <Button onClick={() => cancelRef.current.cancel = true} disabled={status !== "running"}><Pause size={16} style={{ marginRight: 6 }}/>Pause</Button>
              <Button onClick={handleExportJSON} disabled={!rows.length || status === "running"}><Download size={16} style={{ marginRight: 6 }}/>Export JSON</Button>
              <Button onClick={handleExportCSV} disabled={!rows.length || status === "running"}><Download size={16} style={{ marginRight: 6 }}/>Export CSV</Button>
            </div>

            <div style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color:'#475569' }}>
                <span>Progress: {Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0}%</span>
                <span>Rows: {totalCount}</span>
              </div>
              <Progress value={Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0} />
            </div>

            {message && (
              <div style={{ fontSize: 12, color:'#334155', marginTop: 12, display:'flex', gap: 6 }}>
                <Info size={14}/> <span>{message}</span>
              </div>
            )}

            {(costInfo.total > 0) && (
              <div style={{ fontSize: 11, color:'#64748b', marginTop: 8 }}>
                Estimated cost (USD): prompt {costInfo.prompt.toFixed(4)}, completion {costInfo.completion.toFixed(4)}, total {costInfo.total.toFixed(4)}.
              </div>
            )}

            {Object.keys(errorLog).length > 0 && (
              <details style={{ fontSize: 11, color:'#dc2626', marginTop: 12 }}>
                <summary>Error details (first 20)</summary>
                <ul style={{ marginLeft: 18, marginTop: 6 }}>
                  {Object.entries(errorLog).slice(0, 20).map(([i, e]) => (
                    <li key={i}>Row {Number(i)+1}: {String(e)}</li>
                  ))}
                </ul>
              </details>
            )}
          </CardContent>
        </Card>

        {/* Table preview */}
        {Array.isArray(rows) && rows.length > 0 && (
          <Card style={{ marginTop: 20 }}>
            <CardHeader>
              <CardTitle>Data Preview (first 10 rows)</CardTitle>
              <CardDescription>Appends columns: "{resultKey}", "{resultKey}_json", "eval.valid", "eval.score", "eval.decision".</CardDescription>
            </CardHeader>
            <CardContent>
              <div style={{ overflow: 'auto' }}>
                <table style={{ width:'100%', fontSize: 13 }}>
                  <thead>
                    <tr style={{ textAlign:'left', borderBottom:'1px solid #e2e8f0' }}>
                      {displayColumns.map((c, i) => (
                        <th key={`${i}-${String(c)}`} style={{ padding:'8px 16px', color:'#475569' }}>{toCell(c)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((r, i) => (
                      <tr key={i} style={{ borderBottom:'1px solid #e2e8f0' }}>
                        {displayColumns.map((c, j) => (
                          <td key={`${j}-${String(c)}`} style={{ padding:'8px 16px', verticalAlign:'top', maxWidth: 600, whiteSpace: 'pre-wrap' }}>{toCell((r as any)?.[c as any])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Built-in tiny tests */}
        <Card style={{ marginTop: 20, marginBottom: 24 }}>
          <CardHeader>
            <CardTitle style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              { /* icon conditional rendered via text since we don't have Tailwind */ }
              {testsPassed ? "✅" : "❌"} Built-in tests (template, pricing, JSON parsing)
            </CardTitle>
            <CardDescription>Quick local tests for helper functions only.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul style={{ fontSize: 13, lineHeight: 1.6 }}>
              {testResults.map((t, i) => (
                <li key={i} style={{ color: t.pass ? '#15803d' : '#b91c1c' }}>
                  {(t.pass ? "✅ " : "❌ ") + t.name + (t.detail ? (": " + t.detail) : "")}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div style={{ fontSize: 11, color:'#64748b' }}>
          <p><b>Data & Compliance:</b> Ensure UNIDO && partner data policies are followed. If sensitive or confidential data is involved, run locally or in an approved environment && use approved models/keys.</p>
          <p style={{ marginTop: 6 }}><b>Tips:</b> If you hit CORS/rate limits, use your backend as a proxy for OpenAI requests, or lower concurrency.</p>
        </div>
      </div>
    </div>
  );
}
