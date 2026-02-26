import { redirect } from "next/navigation";

export default function ConfigureRedirectPage() {
  redirect("/settings/integrations/pipes");
}
