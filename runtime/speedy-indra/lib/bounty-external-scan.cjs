const EXTERNAL_BOUNTY_URL = 'https://aibtc.com/bounty';
const MIN_EXTERNAL_BOUNTY_REWARD_SATS = 500;

function externalBountiesDisabled() {
  return String(process.env.SPEEDY_INDRA_DISABLE_EXTERNAL_BOUNTIES || '').trim() === '1';
}

function toPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function slugify(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'bounty';
}

function createExternalCandidate({ id, title, rewardSats, timestamp }) {
  const now = toPositiveNumber(timestamp, Date.now());
  const candidateId = `external_${id || slugify(title) || now}`;
  return {
    candidateId,
    messageId: candidateId,
    source: 'external_bounty',
    sourceType: 'external',
    candidateActionType: 'analysis',
    title: String(title || 'External bounty opportunity').slice(0, 180),
    contentPreview: String(title || 'External bounty opportunity').slice(0, 220),
    rewardSats: toPositiveNumber(rewardSats, 0),
    priorityTimestamp: now,
    priorityOrder: 1,
    sentAt: new Date(now).toISOString(),
    stale: false,
    candidateConsumed: false,
  };
}

function isExternalCandidateRewardEligible(candidate) {
  return toPositiveNumber(candidate?.rewardSats, 0) >= MIN_EXTERNAL_BOUNTY_REWARD_SATS;
}

function parseRewardSats(value) {
  const normalized = String(value || '').replace(/[^0-9]/g, '');
  return toPositiveNumber(normalized, 0);
}

function parseExternalBountyHtml(html) {
  const text = String(html || '');
  if (!text) return [];

  const matches = [...text.matchAll(/<a[^>]*href="\/bounty[^"]*"[^>]*>([\s\S]*?)<\/a>/gi)];
  const parsed = matches.slice(0, 5).map((match, index) => {
    const raw = String(match[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!raw) return null;
    const rewardMatch = raw.match(/([0-9][0-9,._]*)\s*(?:sat|sats)/i);
    return createExternalCandidate({
      id: `${slugify(raw)}-${index}`,
      title: raw,
      rewardSats: parseRewardSats(rewardMatch?.[1]),
      timestamp: Date.now() - (index * 1000),
    });
  }).filter(Boolean);

  return parsed;
}

function buildMockExternalCandidates(options = {}) {
  const now = toPositiveNumber(options.nowMs, Date.now());
  return [
    createExternalCandidate({
      id: 'mock-agent-infra',
      title: 'External bounty: agent infra review and implementation analysis',
      rewardSats: 2500,
      timestamp: now,
    }),
  ];
}

async function scanExternalBounties(options = {}) {
  if (externalBountiesDisabled()) {
    return [];
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), toPositiveNumber(options.timeoutMs, 2500));

  try {
    const response = await fetch(EXTERNAL_BOUNTY_URL, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'user-agent': 'speedy-indra/1.0',
      },
    });

    if (!response.ok) {
      return [];
    }

    const html = await response.text();
    const parsed = parseExternalBountyHtml(html);
    return parsed.length > 0 ? parsed : buildMockExternalCandidates(options);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function scanExternalBountiesSync(options = {}) {
  if (externalBountiesDisabled()) {
    return [];
  }
  return buildMockExternalCandidates(options);
}

module.exports = {
  EXTERNAL_BOUNTY_URL,
  MIN_EXTERNAL_BOUNTY_REWARD_SATS,
  isExternalCandidateRewardEligible,
  scanExternalBounties,
  scanExternalBountiesSync,
};
