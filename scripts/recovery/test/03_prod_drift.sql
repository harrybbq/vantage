-- What happened in PRODUCTION after T (run on the clone that plays prod).
\set A '''aaaaaaaa-0000-4000-8000-000000000001'''

-- 200 food diary rows lost (every 10th).
delete from public.nutrition_log
 where user_id = :A and id in (select md5('nl' || g)::uuid from generate_series(10, 2000, 10) g);
-- One row edited after T: production must keep its version.
update public.nutrition_log set calories = 9999 where id = md5('nl1')::uuid;
-- One row added after T: must survive untouched.
insert into public.nutrition_log (id, user_id, log_date, meal_type, food_name, calories)
values (md5('nl-after-T')::uuid, :A, date '2026-10-20', 'dinner', 'Logged after T', 640);

-- A training session lost (its 4 sets cascade with it).
delete from public.training_sessions where id = md5('ts1')::uuid;

-- A measurement re-logged after T under a NEW id on the same date: the
-- bundle row is missing by primary key but collides on (user_id, log_date).
delete from public.body_measurements where id = md5('bm1')::uuid;
insert into public.body_measurements (id, user_id, log_date, waist_cm)
values (md5('bm1-relogged')::uuid, :A, date '2026-03-08', 84.5);

-- DMs lost: the reply and the message it quotes, plus message 1.
delete from public.messages where id in (1, 20, 21);
-- Unfriended after T (a 'review' table: must not come back by default).
delete from public.friendships where requester_id = :A;
-- WHOOP disconnected after T (tokens must never come back).
delete from public.whoop_tokens where user_id = :A;
delete from public.zz_generated_probe where id = md5('gp2')::uuid;

-- The wipe: Alice's state replaced by an empty-looking one. The
-- user_data_history trigger keeps a 'pre-wipe' snapshot.
update public.user_data set state = '{"profile":{"name":""},"coins":0}'::jsonb, updated_at = now()
 where id = :A;
-- And her photo lost.
update public.user_data set photo = null where id = :A;

-- Carol changed her email after T.
update auth.users set email = 'carol.new@example.test' where id = 'cccccccc-0000-4000-8000-000000000003';
