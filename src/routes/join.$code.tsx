import { normalizeRoom } from "@/lib/canvas-room";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { StudioCanvas } from "@/components/studio-canvas";

export const Route = createFileRoute("/join/$code")({
  component: JoinRoom,
});

function JoinRoom() {
  const { code } = Route.useParams();
  const room = normalizeRoom(code);
  const navigate = useNavigate();

  return (
    <StudioCanvas
      room={room || null}
      onRoomChange={(next) => {
        if (next && next !== room) {
          void navigate({ to: "/join/$code", params: { code: next } });
          return;
        }
        if (!next) void navigate({ to: "/" });
      }}
    />
  );
}
