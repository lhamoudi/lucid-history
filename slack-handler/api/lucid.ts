import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

export const config = { api: { bodyParser: false } };

const SNAPSHOTS_REPO = process.env.SNAPSHOTS_REPO!;
const GH_DISPATCH_TOKEN = process.env.GH_DISPATCH_TOKEN!;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET!;

async function readRawBody(req: VercelRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function verifySignature(rawBody: string, timestamp: string, signature: string): boolean {
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const expected =
    'v0=' +
    crypto
      .createHmac('sha256', SLACK_SIGNING_SECRET)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

async function fireDispatch(eventType: string, payload: Record<string, string>): Promise<void> {
  const [owner, repo] = SNAPSHOTS_REPO.split('/');
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GH_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    body: JSON.stringify({ event_type: eventType, client_payload: payload }),
  });
  if (!res.ok) throw new Error(`GitHub dispatch failed: ${res.status} ${await res.text()}`);
}

function ephemeral(text: string) {
  return { response_type: 'ephemeral', text };
}

function runningBlock(lines: string[], userName: string) {
  return {
    response_type: 'in_channel',
    blocks: [
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `Requested by @${userName}` }] },
    ],
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).end();

  const rawBody = await readRawBody(req);
  const timestamp = (req.headers['x-slack-request-timestamp'] as string) ?? '';
  const signature = (req.headers['x-slack-signature'] as string) ?? '';

  if (!verifySignature(rawBody, timestamp, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const body = Object.fromEntries(new URLSearchParams(rawBody));
  const text = (body.text ?? '').trim();
  const responseUrl = body.response_url ?? '';
  const userName = body.user_name ?? 'someone';

  const [subcommand, ...args] = text.split(/\s+/);

  try {
    if (subcommand === 'compare') {
      const [baseId, headId] = args;
      if (!baseId || !headId) {
        return res.json(ephemeral('Usage: `/lucid compare <base-id> <head-id>`'));
      }
      await fireDispatch('lucid-compare', {
        base_id: baseId,
        head_id: headId,
        response_url: responseUrl,
        user_name: userName,
      });
      return res.json(
        runningBlock(
          [`🔄 *Compare running…*`, `*Base:* \`${baseId}\``, `*Head:* \`${headId}\``, `Results will appear here in ~60s.`],
          userName,
        ),
      );
    }

    if (subcommand === 'snapshot') {
      const [docId] = args;
      if (!docId) {
        return res.json(ephemeral('Usage: `/lucid snapshot <doc-id>`'));
      }
      await fireDispatch('lucid-snapshot', {
        doc_id: docId,
        response_url: responseUrl,
        user_name: userName,
      });
      return res.json(
        runningBlock(
          [`📸 *Snapshot running…*`, `Doc: \`${docId}\``, `Results will appear here in ~60s.`],
          userName,
        ),
      );
    }

    if (subcommand === 'digest') {
      const week = args[0] ?? '';
      await fireDispatch('lucid-digest', {
        week,
        response_url: responseUrl,
        user_name: userName,
      });
      return res.json(
        runningBlock(
          [`📋 *Weekly digest running…*`, ...(week ? [`Week: \`${week}\``] : []), `Results will appear here in ~60s.`],
          userName,
        ),
      );
    }

    return res.json(
      ephemeral(
        `Unknown subcommand \`${subcommand || '(none)'}\`. Available:\n• \`/lucid compare <base-id> <head-id>\`\n• \`/lucid snapshot <doc-id>\`\n• \`/lucid digest [YYYY-MM-DD]\``,
      ),
    );
  } catch (err) {
    console.error(err);
    return res
      .status(500)
      .json(ephemeral('❌ Failed to dispatch command. Check bot configuration.'));
  }
}
