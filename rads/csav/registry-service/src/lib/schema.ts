import { z } from "zod";

export const uploadRequestSchema = z.object({ algorithmId: z.uuid() });
