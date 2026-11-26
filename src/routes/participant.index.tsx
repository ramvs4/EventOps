import { createFileRoute } from "@tanstack/react-router";
import { ParticipantApp } from "@/components/portal/participant-interactive";

export const Route = createFileRoute("/participant/")({
  component: ParticipantApp,
});