import { z } from "zod";

export const algorithmRequestSchema = z.object({ algorithmId: z.uuid() });
