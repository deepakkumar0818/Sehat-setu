"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  MessageSquareIcon,
  MicIcon,
  MicOffIcon,
  MonitorUpIcon,
  PhoneOffIcon,
  SendIcon,
  VideoIcon,
  VideoOffIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { PersonAvatar } from "@/components/shared/person-avatar";
import { ErrorState } from "@/components/shared/error-state";
import { useAppointment } from "@/hooks/use-appointments";
import { useCurrentUser } from "@/hooks/use-current-user";
import { useDataStore } from "@/store/data-store";
import { cn } from "@/lib/utils";

interface ChatLine {
  id: string;
  from: "doctor" | "patient";
  text: string;
}

export default function OnlineConsultationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const user = useCurrentUser();
  const { data: appointment, isLoading, isError } = useAppointment(id);
  const doctor = useDataStore((s) => (appointment ? s.db.doctors.find((d) => d.id === appointment.doctorId) : undefined));

  const [phase, setPhase] = useState<"waiting" | "live" | "ended">("waiting");
  const [micOn, setMicOn] = useState(true);
  const [cameraOn, setCameraOn] = useState(true);
  const [screenSharing, setScreenSharing] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatLine[]>([]);

  useEffect(() => {
    if (!appointment) return;
    const timer = setTimeout(() => {
      setPhase("live");
      setChat([{ id: "sys-1", from: "doctor", text: "Hi, can you hear me okay?" }]);
    }, 3500);
    return () => clearTimeout(timer);
  }, [appointment]);

  if (isLoading) return <Skeleton className="h-[70vh] w-full rounded-xl" />;
  if (isError || !appointment || !doctor) return <ErrorState title="Couldn't load this consultation" />;

  const sendChat = () => {
    if (!chatInput.trim()) return;
    setChat((prev) => [...prev, { id: `p-${Date.now()}`, from: "patient", text: chatInput.trim() }]);
    setChatInput("");
  };

  const endCall = () => {
    setPhase("ended");
    toast.success("Call ended. A summary will appear in your consultation history.");
    setTimeout(() => router.push("/portal/consultations"), 1200);
  };

  return (
    <div className="flex h-[calc(100svh-8.5rem)] flex-col overflow-hidden rounded-xl border bg-[#0B1220] text-white">
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-sm font-medium">{doctor.name}</p>
          <p className="text-xs text-white/60">{doctor.specialization}</p>
        </div>
        <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", phase === "live" ? "bg-success/20 text-success" : "bg-warning/20 text-warning")}>
          {phase === "waiting" ? "Connecting…" : phase === "live" ? "Live" : "Call ended"}
        </span>
      </div>

      <div className="relative flex-1">
        {phase === "waiting" && (
          <div className="flex h-full flex-col items-center justify-center gap-3">
            <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="xl" />
            <p className="text-sm text-white/70">Waiting for {doctor.name} to join…</p>
            <div className="flex gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" />
            </div>
          </div>
        )}

        {phase !== "waiting" && (
          <div className="flex h-full items-center justify-center">
            {cameraOn ? (
              <PersonAvatar name={doctor.name} color={doctor.avatarColor} size="xl" className="h-32 w-32 text-3xl" />
            ) : (
              <p className="text-white/50">{doctor.name}&apos;s camera is off</p>
            )}
          </div>
        )}

        {phase !== "waiting" && user && (
          <div className="absolute bottom-4 right-4 flex h-24 w-32 items-center justify-center rounded-lg bg-black/40 ring-1 ring-white/10">
            {cameraOn ? <PersonAvatar name={user.name} color={user.avatarColor} size="lg" /> : <VideoOffIcon className="h-6 w-6 text-white/50" />}
          </div>
        )}

        {chatOpen && phase !== "waiting" && (
          <div className="absolute right-0 top-0 flex h-full w-72 flex-col border-l border-white/10 bg-[#0B1220]/95">
            <div className="border-b border-white/10 px-3 py-2 text-sm font-medium">Chat</div>
            <div className="flex-1 space-y-2 overflow-y-auto p-3">
              {chat.map((line) => (
                <div key={line.id} className={cn("max-w-[85%] rounded-lg px-2.5 py-1.5 text-sm", line.from === "patient" ? "ml-auto bg-primary text-primary-foreground" : "bg-white/10")}>
                  {line.text}
                </div>
              ))}
            </div>
            <div className="flex items-center gap-2 border-t border-white/10 p-2">
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && sendChat()}
                placeholder="Type a message..."
                className="border-white/15 bg-white/5 text-white placeholder:text-white/40"
              />
              <Button size="icon" variant="secondary" onClick={sendChat}><SendIcon className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-center gap-3 border-t border-white/10 p-4">
        <Button variant="secondary" size="icon" className="rounded-full" onClick={() => setMicOn((v) => !v)} aria-label="Toggle microphone">
          {micOn ? <MicIcon className="h-4 w-4" /> : <MicOffIcon className="h-4 w-4" />}
        </Button>
        <Button variant="secondary" size="icon" className="rounded-full" onClick={() => setCameraOn((v) => !v)} aria-label="Toggle camera">
          {cameraOn ? <VideoIcon className="h-4 w-4" /> : <VideoOffIcon className="h-4 w-4" />}
        </Button>
        <Button variant={screenSharing ? "default" : "secondary"} size="icon" className="rounded-full" onClick={() => setScreenSharing((v) => !v)} aria-label="Share screen">
          <MonitorUpIcon className="h-4 w-4" />
        </Button>
        <Button variant={chatOpen ? "default" : "secondary"} size="icon" className="rounded-full" onClick={() => setChatOpen((v) => !v)} aria-label="Toggle chat">
          <MessageSquareIcon className="h-4 w-4" />
        </Button>
        <Button variant="destructive" size="icon" className="rounded-full" onClick={endCall} aria-label="End call">
          <PhoneOffIcon className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
