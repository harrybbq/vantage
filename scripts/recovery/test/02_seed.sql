-- Synthetic data for the "restored copy" (the state of the world at T).
-- Alice (A) is the user being recovered and carries realistic heavy data:
-- a ~450 kB state (backgrounds as base64, a year of vitals), 2,000 food
-- diary rows, training sessions with sets, DMs (one a reply whose heap
-- position is BEFORE the message it quotes), tokens and a photo.
-- Bob (B) and Carol (C) are other users. No real personal data.

insert into auth.users (id, email, encrypted_password) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'alice@example.test', 'HASH-must-never-be-exported'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'bob@example.test',   'HASH-must-never-be-exported'),
  ('cccccccc-0000-4000-8000-000000000003', 'carol@example.test', 'HASH-must-never-be-exported');

insert into public.profiles (id, tier, handle) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'pro', 'alice'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'free', 'bob'),
  ('cccccccc-0000-4000-8000-000000000003', 'free', 'carol');

insert into public.user_data (id, state, photo, updated_at)
select 'aaaaaaaa-0000-4000-8000-000000000001',
       jsonb_build_object(
         'profile', jsonb_build_object('name', 'Alice', 'photo', null),
         'coins', 420,
         'habits', (select jsonb_agg(jsonb_build_object('id', 'h' || g, 'name', 'Habit ' || g, 'done', g % 2 = 0)) from generate_series(1, 25) g),
         'savings', (select jsonb_agg(jsonb_build_object('id', 's' || g, 'name', 'Pot ' || g, 'amount', g * 100)) from generate_series(1, 12) g),
         'vitalsLog', (select jsonb_object_agg(to_char(date '2025-10-01' + g, 'YYYY-MM-DD'),
                                jsonb_build_object('weight', 80 + (g % 7) * 0.1, 'sleep', 7.5, 'rhr', 52 + g % 5, 'recovery', 60 + g % 30))
                        from generate_series(0, 364) g),
         'backgrounds', jsonb_build_object('hub', 'data:image/jpeg;base64,' || repeat('QUFB', 100000))
       ),
       'data:image/jpeg;base64,' || repeat('UEhP', 2000),
       '2026-10-19 21:00:00+00';

insert into public.user_data (id, state) values
  ('bbbbbbbb-0000-4000-8000-000000000002', '{"profile":{"name":"Bob"},"coins":5}'),
  ('cccccccc-0000-4000-8000-000000000003', '{"profile":{"name":"Carol"},"coins":7}');

insert into public.nutrition_macros (id, user_id, name, unit, daily_goal)
select md5('macro' || g)::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', 'Macro ' || g, 'g', g * 50
from generate_series(1, 3) g;

insert into public.nutrition_log (id, user_id, log_date, meal_type, food_name, calories, protein_g, additional_nutrients, created_at)
select md5('nl' || g)::uuid, 'aaaaaaaa-0000-4000-8000-000000000001',
       date '2026-01-01' + (g / 6), (array['breakfast','lunch','dinner','snack'])[1 + g % 4],
       'Food ' || g, 100 + g % 700, (g % 40)::numeric, jsonb_build_object('vit_c_mg', g % 90),
       timestamptz '2026-01-01 08:00+00' + make_interval(hours => g)
from generate_series(1, 2000) g;

insert into public.nutrition_log (id, user_id, log_date, meal_type, food_name, calories)
select md5('nlb' || g)::uuid, 'bbbbbbbb-0000-4000-8000-000000000002', date '2026-02-01' + g, 'lunch', 'Bob food ' || g, 500
from generate_series(1, 10) g;

insert into public.body_measurements (id, user_id, log_date, waist_cm)
select md5('bm' || g)::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', date '2026-03-01' + g * 7, 85 - g * 0.1
from generate_series(1, 30) g;

insert into public.training_sessions (id, user_id, log_date, session_code)
select md5('ts' || g)::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', date '2026-09-01' + g, (array['push','pull','legs','upper','lower'])[g]
from generate_series(1, 5) g;

insert into public.training_sets (id, session_id, user_id, exercise, set_index, reps)
select md5('set' || s || '-' || i)::uuid, md5('ts' || s)::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', 'Lift ' || s, i, 8 + i
from generate_series(1, 5) s, generate_series(1, 4) i;

insert into public.tracker_streaks (user_id, tracker_id, streak) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'steps', 12),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'water', 4),
  ('aaaaaaaa-0000-4000-8000-000000000001', 'read', 30);

insert into public.messages (id, sender_id, recipient_id, body, reply_to) overriding system value values
  (1, 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'hi bob', null),
  (2, 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'hey alice', null),
  (4, 'bbbbbbbb-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000003', 'not alice''s', null),
  (20, 'bbbbbbbb-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'parent', null),
  (21, 'aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'reply to parent', 20);
-- Move message 20 to the end of the heap, so an export lists the reply
-- (21) BEFORE the message it quotes — exercises the retry pass.
update public.messages set body = 'parent (edited)' where id = 20;
select setval(pg_get_serial_sequence('public.messages', 'id'), 100);

insert into public.friendships (requester_id, addressee_id, status) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000002', 'accepted');

insert into public.whoop_tokens (user_id, access_token, refresh_token, expires_at) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'SECRET-ACCESS', 'SECRET-REFRESH', now() + interval '1 hour');
insert into public.push_tokens (user_id, token) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'SECRET-PUSH-TOKEN');
insert into public.client_errors (user_id, message) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'TypeError somewhere');

insert into public.zz_generated_probe (id, user_id, grams) values
  (md5('gp1')::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', 1500),
  (md5('gp2')::uuid, 'aaaaaaaa-0000-4000-8000-000000000001', 2500);
insert into public.zz_no_pk (user_id, note) values ('aaaaaaaa-0000-4000-8000-000000000001', 'no pk');

-- A daily snapshot exists for Alice at T (the trigger takes it on update).
update public.user_data set state = state || '{"coins": 421}'::jsonb
 where id = 'aaaaaaaa-0000-4000-8000-000000000001';
