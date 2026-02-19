"use client";

import { useEffect, useState } from "react";
import { getEnvironment, onEnvironmentChange, setEnvironment, type UiEnvironment } from "../lib/environment";

export default function EnvironmentSelector() {
  const [environment, setEnvironmentState] = useState<UiEnvironment>("DEV");

  useEffect(() => {
    setEnvironmentState(getEnvironment());
    return onEnvironmentChange(setEnvironmentState);
  }, []);

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-stone-700">Environment</span>
      <select
        value={environment}
        onChange={(event) => setEnvironment(event.target.value as UiEnvironment)}
        className="rounded-md border border-stone-300 bg-white px-2 py-1"
      >
        <option value="DEV">DEV</option>
        <option value="STAGE">STAGE</option>
        <option value="PROD">PROD</option>
      </select>
    </label>
  );
}
