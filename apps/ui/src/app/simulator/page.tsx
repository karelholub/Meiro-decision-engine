import { redirect } from "next/navigation";

export default function LegacySimulatorRedirect() {
  redirect("/simulate");
}
