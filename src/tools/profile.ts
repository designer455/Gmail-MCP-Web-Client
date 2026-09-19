import { z } from 'zod';
import { getProfile, GmailProfileResult } from '../gmail/profile.js';

export const profileToolSchema = z.object({});

/**
 * Handler for gmail_get_profile
 * Fetches profile of the currently authenticated user's Gmail account.
 * Does not accept account or user ID parameters.
 */
export async function handleProfileTool(): Promise<GmailProfileResult> {
  return await getProfile();
}
