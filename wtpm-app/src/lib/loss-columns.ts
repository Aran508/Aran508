/** Excel 'OEE data 1' loss column letter → loss category code (see migration 002). */
export const EXCEL_LOSS_COLUMNS: Record<string, string> = {
  R: 'breakdown', S: 'part_change', T: 'tool_change', U: 'startup', V: 'minor_stoppage',
  W: 'speed_loss', X: 'defect_loss', Y: 'rework_loss', Z: 'planned_downtime', AA: 'no_power',
  AB: 'no_manpower', AC: 'no_manpower_repair', AD: 'no_air', AE: 'no_material', AF: 'no_schedule',
  AG: 'no_tools', AH: 'inspection', AI: 'tryout_development', AJ: 'tpm_cleaning',
  AK: 'measurement_adjust', AL: 'die_jig_breakage', AM: 'other',
};
export const MANAGEMENT_CODES = ['no_power','no_manpower','no_manpower_repair','no_air','no_material','no_schedule','no_tools','inspection','tryout_development','tpm_cleaning'];
export const REVISED_EXCL_CODES = ['planned_downtime','no_manpower','no_material','no_schedule','tryout_development','tpm_cleaning'];
export const DEFAULT_CATEGORY_FLAGS = Object.values(EXCEL_LOSS_COLUMNS).map((code) => ({
  code, is_management: MANAGEMENT_CODES.includes(code), is_revised_excl: REVISED_EXCL_CODES.includes(code),
}));
