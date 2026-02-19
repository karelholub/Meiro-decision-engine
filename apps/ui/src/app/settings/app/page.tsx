"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getDecisionWizardEnabled,
  getDecisionWizardEnvDefaultValue,
  getDecisionWizardMode,
  onAppSettingsChange,
  resetAppSettings,
  setDecisionWizardMode,
  type DecisionWizardMode
} from "../../../lib/app-settings";

export default function AppSettingsPage() {
  const [wizardMode, setWizardMode] = useState<DecisionWizardMode>("default");

  useEffect(() => {
    setWizardMode(getDecisionWizardMode());
    return onAppSettingsChange((settings) => {
      setWizardMode(settings.decisionWizardMode);
    });
  }, []);

  const wizardEnabled = useMemo(() => getDecisionWizardEnabled(), [wizardMode]);
  const envDefault = useMemo(() => getDecisionWizardEnvDefaultValue(), []);

  return (
    <section className="space-y-4">
      <header className="panel p-4">
        <h2 className="text-xl font-semibold">App Settings</h2>
        <p className="text-sm text-stone-700">Global UI preferences for this workspace and browser profile.</p>
      </header>

      <article className="panel space-y-3 p-4">
        <div>
          <h3 className="font-semibold">Decision Builder Wizard</h3>
          <p className="text-sm text-stone-700">
            Control whether the Decision Builder Wizard is available in the Decisions editor.
          </p>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="default"
              checked={wizardMode === "default"}
              onChange={() => setDecisionWizardMode("default")}
            />
            <span className="ml-2 font-medium">Use environment default</span>
            <p className="mt-1 text-xs text-stone-600">Default is currently {envDefault ? "enabled" : "disabled"}.</p>
          </label>

          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="enabled"
              checked={wizardMode === "enabled"}
              onChange={() => setDecisionWizardMode("enabled")}
            />
            <span className="ml-2 font-medium">Force enabled</span>
            <p className="mt-1 text-xs text-stone-600">Always show Wizard in this browser.</p>
          </label>

          <label className="rounded-md border border-stone-300 p-3 text-sm">
            <input
              type="radio"
              name="wizard-mode"
              value="disabled"
              checked={wizardMode === "disabled"}
              onChange={() => setDecisionWizardMode("disabled")}
            />
            <span className="ml-2 font-medium">Force disabled</span>
            <p className="mt-1 text-xs text-stone-600">Use Advanced JSON only.</p>
          </label>
        </div>

        <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-sm">
          <p>
            Effective status: <strong>{wizardEnabled ? "Enabled" : "Disabled"}</strong>
          </p>
          <p className="mt-1 text-xs text-stone-600">Applies immediately in the editor after navigation or refresh.</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="rounded-md border border-stone-300 px-3 py-2 text-sm"
            onClick={() => {
              resetAppSettings();
              setWizardMode(getDecisionWizardMode());
            }}
            type="button"
          >
            Reset to defaults
          </button>
        </div>
      </article>
    </section>
  );
}
