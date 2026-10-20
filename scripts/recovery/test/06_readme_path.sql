-- The README's CLI path, client side: psql reads the bundle file itself
-- (\set from a backquoted `cat`), no server file access needed.
\set bundle `cat bundle.json`
select (public.import_user_bundle(:'bundle'::jsonb, 'dry_run') ->> 'ok') = 'true' as readme_path_ok \gset
\if :readme_path_ok
  \echo 'ok  README psql path: \\set bundle `cat bundle.json` + import_user_bundle(:''bundle''::jsonb) works on a 1 MB bundle'
\else
  \echo 'FAIL: README psql path'
  select 1/0;
\endif
