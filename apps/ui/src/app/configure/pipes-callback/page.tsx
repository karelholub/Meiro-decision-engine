import { redirect } from "next/navigation";

export default function ConfigurePipesCallbackRedirect() {
  redirect("/settings/integrations/pipes-callback");
}
