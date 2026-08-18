import { normalizeRoom } from "@/lib/canvas-room";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { StudioCanvas } from "@/components/studio-canvas";

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): { room?: string } => {
    const room = typeof s.room === "string" ? normalizeRoom(s.room) : "";
    return room ? { room } : {};
  },
  component: Home,
});

function Home() {
  const { room } = Route.useSearch();
  const navigate = useNavigate({ from: "/" });
  return (
    <StudioCanvas
      room={room || null}
      onRoomChange={(code) => {
        void navigate({ search: code ? { room: code } : {}, replace: true });
      }}
    />
  );
}
