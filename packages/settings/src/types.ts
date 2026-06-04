export type SettingsSectionId = "patch" | "fixture-types";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  caption: string;
}
