import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

extendZodWithOpenApi(z);

export { z };

export const apiErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
}).openapi("ApiError");

export function errorResponse(description: string, code: string, message: string) {
  return {
    description,
    content: {
      "application/json": {
        schema: apiErrorSchema,
        example: { error: { code, message } },
      },
    },
  };
}
