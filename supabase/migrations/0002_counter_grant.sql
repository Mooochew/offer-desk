-- 0001 revoked execute on increment_counter from `public`, which also removed it from the
-- server's service_role (it had execute only through `public`). Grant it back to the server only.
grant execute on function public.increment_counter(text, integer) to service_role;
