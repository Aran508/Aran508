-- Reference data taken directly from the supplied workbook.

-- 'Shift Timings' sheet: planned time = total - lunch - tea - TPM  → 445 / 460 / 370 minutes
INSERT INTO shifts (id, name, timings, start_time, end_time, total_minutes, lunch_minutes, tea_minutes, tpm_minutes) VALUES
 (1, 'Shift 1', '6:30 am to 3 pm',      '06:30', '15:00', 510, 30, 20, 15),
 (2, 'Shift 2', '3 pm to 11:30 pm',     '15:00', '23:30', 510, 30, 20, 0),
 (3, 'Shift 3', '11:30 pm to 6:30 am',  '23:30', '06:30', 420, 30, 20, 0);

-- Loss columns R..AM of 'OEE data 1'.
--   oee_group follows the 'Weekly Loss Report1-data' grouping (A / P / Q / management block)
--   is_management = Excel "Management Losses" AR = SUM(AA:AJ)
--   is_revised_excl = Excel BC = Z + AB + AE + AF + AI + AJ
INSERT INTO loss_categories (code, name, excel_column, oee_group, section, is_management, is_revised_excl, requires_reason, is_common, sort_order) VALUES
 ('breakdown',          'Break Down',                    'R',  'A', 'process',    FALSE, FALSE, FALSE, TRUE,  1),
 ('part_change',        'Part Changes',                  'S',  'A', 'process',    FALSE, FALSE, FALSE, TRUE,  2),
 ('tool_change',        'Tool Changes',                  'T',  'A', 'process',    FALSE, FALSE, FALSE, TRUE,  3),
 ('startup',            'Start Up Losses',               'U',  'A', 'process',    FALSE, FALSE, FALSE, TRUE,  4),
 ('minor_stoppage',     'Minor Stoppage',                'V',  'P', 'process',    FALSE, FALSE, FALSE, TRUE,  5),
 ('speed_loss',         'Speed Loss',                    'W',  'P', 'process',    FALSE, FALSE, FALSE, FALSE, 6),
 ('defect_loss',        'Defect',                        'X',  'Q', 'process',    FALSE, FALSE, FALSE, FALSE, 7),
 ('rework_loss',        'Rework',                        'Y',  'Q', 'process',    FALSE, FALSE, FALSE, FALSE, 8),
 ('planned_downtime',   'Planned Downtime',              'Z',  'M', 'management', FALSE, TRUE,  FALSE, TRUE,  9),
 ('no_power',           'No Power',                      'AA', 'M', 'management', TRUE,  FALSE, FALSE, FALSE, 10),
 ('no_manpower',        'No Manpower',                   'AB', 'M', 'management', TRUE,  TRUE,  FALSE, TRUE,  11),
 ('no_manpower_repair', 'No Manpower to Repair',         'AC', 'M', 'management', TRUE,  FALSE, FALSE, FALSE, 12),
 ('no_air',             'No Air',                        'AD', 'M', 'management', TRUE,  FALSE, FALSE, FALSE, 13),
 ('no_material',        'No Material',                   'AE', 'M', 'management', TRUE,  TRUE,  FALSE, TRUE,  14),
 ('no_schedule',        'No Schedule',                   'AF', 'M', 'management', TRUE,  TRUE,  FALSE, FALSE, 15),
 ('no_tools',           'No Tools',                      'AG', 'M', 'management', TRUE,  FALSE, FALSE, FALSE, 16),
 ('inspection',         'Inspection',                    'AH', 'M', 'management', TRUE,  FALSE, FALSE, TRUE,  17),
 ('tryout_development', 'Try Out & Development',         'AI', 'M', 'management', TRUE,  TRUE,  FALSE, FALSE, 18),
 ('tpm_cleaning',       'TPM & Cleaning',                'AJ', 'M', 'management', TRUE,  TRUE,  FALSE, TRUE,  19),
 ('measurement_adjust', 'Measurement & Adjustment',      'AK', 'M', 'management', FALSE, FALSE, FALSE, FALSE, 20),
 ('die_jig_breakage',   'Die, Jig & Tool Breakage',      'AL', 'M', 'management', FALSE, FALSE, FALSE, FALSE, 21),
 ('other',              'Other (reason in detail)',      'AM', 'M', 'management', FALSE, FALSE, TRUE,  FALSE, 22);

INSERT INTO settings (key, value) VALUES
 ('photo_mandatory', 'false'),
 ('high_downtime_pct', '60'),          -- warn when total losses exceed this % of planned time
 ('plant_name', '"C1 Plant"'),
 ('oee_target', '0.85'),
 ('oee_bands', '{"low":0.6,"high":0.8}'),  -- Excel ranking table: OEE(<60%) / OEE(60%-80%)
 ('max_photo_mb', '12');
