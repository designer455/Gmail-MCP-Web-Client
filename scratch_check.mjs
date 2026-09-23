import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

async function diagnose() {
  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  const email = process.env.TEST_SUPABASE_EMAIL;
  const password = process.env.TEST_SUPABASE_PASSWORD;

  console.log('SUPABASE_URL:', url);
  console.log('SUPABASE_SECRET_KEY present:', Boolean(secretKey));

  if (!url || !secretKey) {
    console.error('Missing Supabase credentials');
    return;
  }

  const supabase = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Check Supabase Auth
  let authUserId = null;
  if (email && password) {
    console.log('Testing sign in with email:', email);
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (authError) {
      console.log('Auth sign in error:', authError.message);
    } else {
      authUserId = authData.user.id;
      console.log('Auth sign in SUCCESS! User ID:', authUserId, 'Email:', authData.user.email);
    }
  }

  // Check gmail_accounts table
  console.log('\n--- Checking gmail_accounts table ---');
  const { data: allRows, error: allErr } = await supabase
    .from('gmail_accounts')
    .select('id, user_id, email, google_account_id, token_expiry, created_at, updated_at');

  if (allErr) {
    console.log('Query error for gmail_accounts:', allErr);
  } else {
    console.log('Total rows in gmail_accounts:', allRows?.length);
    for (const r of allRows || []) {
      console.log({
        id: r.id,
        user_id: r.user_id,
        email: r.email,
        google_account_id: r.google_account_id,
        token_expiry: r.token_expiry,
        updated_at: r.updated_at,
      });
    }
  }

  if (authUserId) {
    console.log(`\n--- Querying by authenticated user_id: ${authUserId} ---`);
    const { data: userRow, error: userErr } = await supabase
      .from('gmail_accounts')
      .select('*')
      .eq('user_id', authUserId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (userErr) {
      console.log('userRow query error:', userErr);
    } else if (!userRow) {
      console.log(`NO ROW FOUND in gmail_accounts with user_id = "${authUserId}"!`);
    } else {
      console.log('Found row for user!');
      console.log('Row ID:', userRow.id);
      console.log('Row email:', userRow.email);
      console.log('Encrypted access token length:', userRow.encrypted_access_token?.length);
      console.log('Encrypted refresh token length:', userRow.encrypted_refresh_token?.length);
    }
  }

  // Also check auth.users in Supabase to see all users
  console.log('\n--- Checking auth.admin.listUsers() ---');
  try {
    const { data: usersData, error: usersErr } = await supabase.auth.admin.listUsers();
    if (usersErr) {
      console.log('listUsers error:', usersErr);
    } else {
      console.log('Total registered Supabase users:', usersData.users.length);
      for (const u of usersData.users) {
        console.log({ id: u.id, email: u.email, createdAt: u.created_at });
      }
    }
  } catch (err) {
    console.log('admin.listUsers failed:', err);
  }
}

diagnose().catch(console.error);
