import { useEffect, useRef, useState } from "react";
import { Copy, Loader2, MessageSquare, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Finding } from "@/lib/core";
import { findingStatement } from "@/lib/ai-context";
import { toast } from "sonner";
import ReactMarkdown from "react-markdown";

export function ClaudeExplanation({ finding, source }: { finding: Finding; source: string }) {
  const [open, setOpen] = useState(false);
  const [sql, setSql] = useState(() => findingStatement(source, finding));
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [stopped, setStopped] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function explain() {
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setText("");
    setError("");
    setStopped(false);
    let accumulated = "";
    let terminal = false;
    try {
      const response = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ consent: true, sql, ruleId: finding.ruleId }),
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.message || "Claude request failed.");
      }
      if (!response.body) throw new Error("Claude returned no response.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const consume = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "text") {
          accumulated += event.text;
          setText(accumulated);
        }
        if (event.type === "error") {
          terminal = true;
          throw new Error(event.message);
        }
        if (event.type === "done") terminal = true;
      };
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, { stream: !chunk.done });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) consume(line);
        if (chunk.done) {
          consume(buffer);
          break;
        }
      }
      if (!terminal)
        throw new Error("Claude’s response was interrupted. No automatic retry was made.");
      if (!accumulated && !controller.signal.aborted)
        throw new Error("Claude returned no explanation.");
    } catch (e) {
      if (controller.signal.aborted) setStopped(true);
      else setError(e instanceof Error ? e.message : "Claude request failed.");
    } finally {
      setBusy(false);
      abort.current = null;
    }
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="mt-3"
        onClick={() => {
          setSql(findingStatement(source, finding));
          setOpen(true);
        }}
      >
        <MessageSquare /> Explain with Claude
      </Button>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!value) abort.current?.abort();
          setOpen(value);
        }}
      >
        <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Claude · {finding.ruleId}</DialogTitle>
            <DialogDescription>
              Optional cloud explanation. Your local findings stay unchanged.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">
            Sending shares only the SQL below and this rule’s details with Claude through Lovable
            Cloud. Anthropic may retain this data under its provider policy. Remove sensitive values
            and credentials first. AI requests use workspace credits.
          </p>
          <textarea
            aria-label="SQL to share with Claude"
            value={sql}
            disabled={busy}
            onChange={(e) => setSql(e.target.value)}
            className="min-h-32 w-full rounded-md border bg-code p-3 font-mono text-xs text-code-foreground"
          />
          <p className="text-xs text-muted-foreground">
            {sql.length.toLocaleString()} / 12,000 characters · No other files are shared.
          </p>
          <div className="flex flex-wrap gap-2">
            {busy ? (
              <Button variant="outline" onClick={() => abort.current?.abort()}>
                <Square /> Stop
              </Button>
            ) : (
              <Button disabled={!sql.trim() || sql.length > 12000} onClick={() => void explain()}>
                <MessageSquare /> Send SQL to Claude
              </Button>
            )}
            {text && (
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy Claude explanation"
                title="Copy explanation"
                onClick={() =>
                  void navigator.clipboard
                    .writeText(text)
                    .then(() => toast.success("Explanation copied"))
                    .catch(() => toast.error("Could not copy explanation"))
                }
              >
                <Copy />
              </Button>
            )}
          </div>
          {busy && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
              {text ? "Claude is writing…" : "Claude is reviewing…"}
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-sev-error">
              {error}
            </p>
          )}
          {stopped && (
            <p role="status" className="text-sm text-muted-foreground">
              Stopped. Partial output is preserved.
            </p>
          )}
          {text && (
            <div className="prose-doc min-w-0 break-words border-t pt-4 text-sm leading-relaxed">
              <ReactMarkdown
                skipHtml
                components={{ img: () => null, a: ({ children }) => <span>{children}</span> }}
              >
                {text}
              </ReactMarkdown>
            </div>
          )}
          <p className="text-xs text-muted-foreground">
            AI advice can be wrong. Review and test proposed SQL; nothing is applied or executed.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
