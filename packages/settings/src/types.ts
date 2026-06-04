export type SettingsSectionId = "connectivity" | "fixture-types";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  caption: string;
}
