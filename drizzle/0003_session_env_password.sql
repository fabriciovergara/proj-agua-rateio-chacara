-- Older sessions can't tell which password opened them: they stay unlocked,
-- without the APP_PASSWORD-only options, until that browser unlocks again.
ALTER TABLE `sessions` ADD `with_env_password` integer DEFAULT false NOT NULL;
