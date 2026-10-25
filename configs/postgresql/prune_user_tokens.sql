DELETE FROM public.user_token
WHERE type = 'verify' AND expires <= CURRENT_TIMESTAMP;
