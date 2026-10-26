DELETE FROM public.user_token
WHERE type IN ('verify', 'password_reset', 'password_changed')
  AND expires <= CURRENT_TIMESTAMP;
