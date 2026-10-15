"use server";

import { z } from "zod";
import { action } from "@/server/action";
import { f } from "@/server/forms";
import { setPartDrawing } from "@/server/services/parts";

export const setPartDrawingAction = action(
  "part.drawing_link",
  z.object({ partId: f.uuid(), documentId: f.uuid("Select a drawing document.") }),
  async (ctx, { partId, documentId }) => {
    await setPartDrawing(ctx, partId, documentId);
    return "Drawing document linked. Its released revision becomes the default for new jobs.";
  },
  { revalidate: (i) => [`/parts/${i.partId}`, "/parts"] },
);
