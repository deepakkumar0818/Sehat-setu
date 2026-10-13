"use client";

import { useEffect, useRef, useState } from "react";
import { SendIcon, SparklesIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { AIBadge } from "@/components/shared/ai-panel";
import { useCurrentUser } from "@/hooks/use-current-user";
import { cn } from "@/lib/utils";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface AIChatProps {
  title: string;
  description: string;
  suggestedPrompts: string[];
  onAsk: (question: string) => Promise<string>;
  autoAsk?: string | null;
  className?: string;
}

export function AIChat({ title, description, suggestedPrompts, onAsk, autoAsk, className }: AIChatProps) {
  const user = useCurrentUser();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isThinking]);

  const send = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || isThinking) return;
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", content: trimmed }]);
    setInput("");
    setIsThinking(true);
    const answer = await onAsk(trimmed);
    setMessages((prev) => [...prev, { id: `a-${Date.now()}`, role: "assistant", content: answer }]);
    setIsThinking(false);
  };

  useEffect(() => {
    if (autoAsk) send(autoAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoAsk]);

  return (
    <div className={cn("flex h-[calc(100svh-11rem)] flex-col rounded-xl border bg-card", className)}>
      <div className="flex items-center gap-2.5 border-b p-4">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-ai/15 text-ai">
          <SparklesIcon className="h-5 w-5" />
        </div>
        <div>
          <p className="font-semibold text-foreground">{title}</p>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Suggested questions</p>
            <div className="flex flex-wrap gap-2">
              {suggestedPrompts.map((prompt) => (
                <button
                  key={prompt}
                  onClick={() => send(prompt)}
                  className="rounded-full border bg-background px-3 py-1.5 text-sm text-foreground hover:bg-muted"
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={cn("flex items-start gap-2.5", m.role === "user" && "flex-row-reverse")}>
            {m.role === "assistant" ? (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ai/15 text-ai">
                <SparklesIcon className="h-4 w-4" />
              </div>
            ) : (
              user && <PersonAvatar name={user.name} color={user.avatarColor} size="sm" />
            )}
            <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted text-foreground")}>
              {m.content}
              {m.role === "assistant" && (
                <div className="mt-1.5"><AIBadge /></div>
              )}
            </div>
          </div>
        ))}

        {isThinking && (
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ai/15 text-ai">
              <SparklesIcon className="h-4 w-4" />
            </div>
            <div className="flex gap-1 rounded-2xl bg-muted px-3.5 py-2.5">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted-foreground" />
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        className="flex items-center gap-2 border-t p-3"
      >
        <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask Sehat AI..." disabled={isThinking} />
        <Button type="submit" size="icon" disabled={isThinking || !input.trim()} aria-label="Send">
          <SendIcon className="h-4 w-4" />
        </Button>
      </form>
    </div>
  );
}
