-- Compound violent words that whole-word matching misses ("bloodbath" is not "blood"). Safe to re-run.
INSERT INTO blocked_keywords (keyword, case_sensitive) VALUES
    ('bloodbath', false),
    ('bloodshed', false),
    ('dismemberment', false),
    ('dismember', false),
    ('massacre', false),
    ('beheaded', false),
    ('decapitated', false),
    ('torture', false),
    ('mutilated', false),
    ('gruesome', false)
ON CONFLICT (keyword) DO NOTHING;
