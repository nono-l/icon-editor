import { createFileRoute } from "@tanstack/react-router";
import { getSql } from "@/lib/db";
import { createSignalingHandler } from "@/lib/p2p-sync";

const handleSignaling = createSignalingHandler({
  query: async (text, params) => {
    const sql = await getSql();
    return sql.query(text, params);
  },
});

const handle = ({ request }: { request: Request }) => handleSignaling(request);

export const Route = createFileRoute("/api/rtc")({
  server: { handlers: { GET: handle, POST: handle } },
});
