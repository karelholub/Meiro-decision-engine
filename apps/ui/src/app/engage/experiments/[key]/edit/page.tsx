import ExperimentEditorClient from "./editor-client";

export default async function ExperimentEditPage({ params }: { params: Promise<{ key: string }> }) {
  const resolved = await params;
  return <ExperimentEditorClient experimentKey={resolved.key} />;
}
