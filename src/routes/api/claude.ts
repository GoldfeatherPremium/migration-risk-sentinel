import { createFileRoute } from "@tanstack/react-router";
import { handleExplanation } from "@/lib/ai/claude.server";

export const Route = createFileRoute("/api/claude")({
  server: { handlers: { POST: ({ request }) => handleExplanation(request) } },
});
