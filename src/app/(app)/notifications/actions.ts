"use server";

import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { markRead, NOTIFICATION_TYPES, setPreference, type NotificationType } from "@/server/services/notifications";

export const markReadAction = action(
  "notification.read",
  z.object({ id: f.uuid() }),
  async (ctx, { id }) => {
    await markRead(ctx, [id]);
  },
  { revalidate: "/notifications" },
);

export const markAllReadAction = action(
  "notification.read_all",
  z.object({}),
  async (ctx) => {
    await markRead(ctx, "all");
    return "All notifications marked as read.";
  },
  { revalidate: "/notifications" },
);

const TYPE_KEYS = Object.keys(NOTIFICATION_TYPES) as [NotificationType, ...NotificationType[]];

/** Saves every preference row in one submission: `inApp` / `email` carry the checked type keys. */
export const savePreferencesAction = action(
  "notification.preferences",
  z.object({ inApp: f.strs(), email: f.strs() }),
  async (ctx, { inApp, email }) => {
    for (const t of TYPE_KEYS) await setPreference(ctx, t, inApp.includes(t), email.includes(t));
    return "Notification preferences saved.";
  },
  { revalidate: "/notifications" },
);
