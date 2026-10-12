import type { AiConfig } from "@aili/schemas";
import { keyPresent } from "../metering";

// Whether a LIVE bake-off may start (docs/m3-plan.md slice 7a). It refuses unless Lucky has recorded
// the provider's monthly limit, both models are configured, both keys are present (presence only;
// the values are never read here) and the kill switch is off. Each gap is named.

export function liveRefusals(config: AiConfig, env: Record<string, string | undefined>): string[] {
  const out: string[] = [];
  if (!config.provider_monthly_limit_set) out.push("provider_monthly_limit_set is not recorded in config/ai.json (Lucky records it after setting the limit in the provider's dashboard)");
  for (const m of ["professor", "router"] as const) {
    const c = config.models[m];
    if (!c.provider) out.push(`models.${m}.provider is not set`);
    if (!c.model) out.push(`models.${m}.model is not set`);
    if (!keyPresent(config, m, env)) out.push(`no key in ${c.api_key_env} (the variable is read, never printed)`);
  }
  if (env.AILI_AI_KILL_SWITCH === "1") out.push("the kill switch is on (AILI_AI_KILL_SWITCH=1)");
  return out;
}
