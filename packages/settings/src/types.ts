export type SettingsSectionId = "patch" | "fixture-types" | "network" | "output";

export interface SettingsSection {
  id: SettingsSectionId;
  label: string;
  caption: string;
}
