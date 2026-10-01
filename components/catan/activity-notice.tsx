"use client";

import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { activitySummary, type CatanActivity } from "@/lib/catan-notifications";

export const ACTIVITY_NOTICE_MS = 4000;

function TimedActivityNotice({ latest, unreadCount, onOpen, onRead }: {
  latest: CatanActivity; unreadCount: number; onOpen: () => void; onRead: () => void;
}) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), ACTIVITY_NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;
  return <div className="catan-activity-bar">
    <button type="button" onClick={onOpen} aria-label={`${latest.title}: ${activitySummary(latest)}. ${unreadCount} neue ${unreadCount === 1 ? "Meldung" : "Meldungen"} ansehen`}>
      <Bell />
      <span className="catan-activity-copy" role="status" aria-live="polite" aria-atomic="true">
        <strong>{latest.title}{unreadCount > 1 ? ` · ${unreadCount} neu` : ""}</strong>
        <span>{activitySummary(latest)}</span>
      </span>
    </button>
    <Button variant="ghost" size="icon" aria-label="Neue Meldungen als gelesen markieren" onClick={onRead}><X /></Button>
    <span className="catan-activity-progress" aria-hidden="true" style={{ animationDuration: `${ACTIVITY_NOTICE_MS}ms` }} />
  </div>;
}

export function ActivityNotice({ scope, unread, onOpen, onRead }: {
  scope: string; unread: CatanActivity[]; onOpen: () => void; onRead: () => void;
}) {
  const latest = unread.at(-1);
  if (!latest) return null;
  // Keep the expired child mounted: repeated snapshots must not replay its event.
  return <TimedActivityNotice key={JSON.stringify([scope, latest.id])} latest={latest} unreadCount={unread.length} onOpen={onOpen} onRead={onRead} />;
}
