import { z } from "zod";

export const iSimConfig = z.object({

})

export type SimConfig = z.infer<typeof iSimConfig>