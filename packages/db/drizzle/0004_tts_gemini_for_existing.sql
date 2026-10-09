-- Gemini is now the default voice (falling back to Edge, then the browser). Profiles still on
-- the old default (browser voices) move to it; an explicit Edge or OpenAI choice is kept.
UPDATE `user_profiles` SET `tts_provider` = 'google', `tts_voice` = NULL WHERE `tts_provider` = 'browser';
