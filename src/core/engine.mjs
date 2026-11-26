import { parseTheme, themeToCssVariables } from '../../shared/theme-core.mjs';
import { adjustTheme, auditTheme, deriveTheme, extractSeeds, randomTheme, repairTheme, toVariant } from '../../shared/theme-derive.mjs';
import { applyStyleRecipe, STYLE_RECIPES } from '../../shared/style-recipes.mjs';

export { STYLE_RECIPES, deriveTheme, extractSeeds, randomTheme, repairTheme, toVariant };
export function styleTheme(definition, style) {
  if (!style.id || style.strength === 0 || !STYLE_RECIPES.some((recipe) => recipe.id === style.id)) return definition;
  return applyStyleRecipe(style.id, definition, { ...style.options, strength: style.strength }).definition;
}
export function tuneTheme(definition, tune) {
  const { groups, protectStatus, protectSyntax, global } = tune;
  let output = adjustTheme(definition, { ...global, protectStatus, protectSyntax }).definition;
  for (const [group, knobs] of Object.entries(groups ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    output = adjustTheme(output, { ...knobs, group, protectStatus, protectSyntax }).definition;
  }
  return output;
}
export function previewTheme(resolved) {
  const parsed = parseTheme(resolved);
  return { parsed, cssVars: themeToCssVariables(parsed), audit: auditTheme(resolved) };
}
