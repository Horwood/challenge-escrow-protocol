import { canonicalizeValue, domainHash } from "../portable/canonical.mjs";

const DECIMAL = /^(0|[1-9][0-9]*)$/;
const HASH = /^0x[0-9a-f]{64}$/;
const FINGERPRINT = /^sha256:[0-9a-f]{64}$/;
const POLICY_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_UINT64 = (1n << 64n) - 1n;
const MAX_EPOCH_SECONDS = 365n * 24n * 60n * 60n;
const ROLE_ORDER = Object.freeze(["arbiter", "pauser", "resolver"]);
const CUSTODY = new Set(["hardware", "institutional", "offline-recovery"]);
const FORBIDDEN = Object.freeze([
  "delegatecall",
  "owner-withdrawal",
  "payout-redirection",
  "proxy-upgrade",
  "token-rescue",
]);

export class AuthorityPolicyError extends Error {
  constructor(code, path, message) {
    super(message);
    this.name = "AuthorityPolicyError";
    this.code = code;
    this.path = path;
  }
}

function reject(code, path, message) {
  throw new AuthorityPolicyError(code, path, message);
}

function requireValue(condition, code, path, message) {
  if (!condition) reject(code, path, message);
}

function keys(value, required, optional, path) {
  requireValue(value && typeof value === "object" && !Array.isArray(value), "Structure", path, `${path} must be an object`);
  const allowed = new Set([...required, ...optional]);
  for (const key of required) requireValue(Object.hasOwn(value, key), "Structure", `${path}.${key}`, `${path}.${key} is required`);
  for (const key of Object.keys(value)) requireValue(allowed.has(key), "UnknownField", `${path}.${key}`, `${path}.${key} is unknown`);
}

function decimal(value, path) {
  requireValue(typeof value === "string" && value.length <= 78 && DECIMAL.test(value), "NonCanonicalDecimal", path, `${path} must be a canonical decimal string`);
  const parsed = BigInt(value);
  requireValue(parsed <= MAX_UINT256, "DecimalRange", path, `${path} exceeds uint256`);
  return parsed;
}

function uint64(value, path) {
  const parsed = decimal(value, path);
  requireValue(parsed <= MAX_UINT64, "DecimalRange", path, `${path} exceeds uint64`);
  return parsed;
}

function hash(value, path) {
  requireValue(typeof value === "string" && HASH.test(value), "InvalidHash", path, `${path} must be lowercase bytes32`);
  return value;
}

function fingerprint(value, path) {
  requireValue(typeof value === "string" && FINGERPRINT.test(value), "InvalidFingerprint", path, `${path} must be an endpoint-neutral SHA-256 fingerprint`);
  requireValue(value !== `sha256:${"0".repeat(64)}`, "ZeroMember", path, `${path} cannot be the zero fingerprint`);
  return value;
}

export function authorityPolicyHash(policy) {
  const body = structuredClone(policy);
  delete body.policyHash;
  return domainHash("challenge-escrow.authority-policy/v1", body);
}

function validateContext(context) {
  keys(context, ["observedAt", "expectedEpoch", "expectedPredecessorPolicyHash"], [], "context");
  uint64(context.observedAt, "context.observedAt");
  decimal(context.expectedEpoch, "context.expectedEpoch");
  if (context.expectedPredecessorPolicyHash !== null) {
    hash(context.expectedPredecessorPolicyHash, "context.expectedPredecessorPolicyHash");
  }
}

export function validateAuthorityPolicy(policy, context) {
  keys(policy, ["schema", "policyId", "policyHash", "lineage", "roles", "forbiddenCapabilities", "rotation"], [], "policy");
  requireValue(policy.schema === "challenge-escrow.authority-policy/v1", "Schema", "policy.schema", "authority policy schema drifted");
  requireValue(typeof policy.policyId === "string" && POLICY_ID.test(policy.policyId), "PolicyId", "policy.policyId", "policy ID is invalid");
  hash(policy.policyHash, "policy.policyHash");

  keys(policy.lineage, ["epoch", "predecessorPolicyHash", "announcedAt", "validFrom", "validUntil"], [], "policy.lineage");
  const epoch = decimal(policy.lineage.epoch, "policy.lineage.epoch");
  const announcedAt = uint64(policy.lineage.announcedAt, "policy.lineage.announcedAt");
  const validFrom = uint64(policy.lineage.validFrom, "policy.lineage.validFrom");
  const validUntil = uint64(policy.lineage.validUntil, "policy.lineage.validUntil");
  requireValue(epoch >= 1n, "LineageMismatch", "policy.lineage.epoch", "epoch zero is not valid");
  if (epoch === 1n) {
    requireValue(policy.lineage.predecessorPolicyHash === null, "LineageMismatch", "policy.lineage.predecessorPolicyHash", "epoch one cannot name a predecessor");
  } else {
    requireValue(policy.lineage.predecessorPolicyHash !== null, "LineageMismatch", "policy.lineage.predecessorPolicyHash", "non-genesis epoch requires a predecessor");
    hash(policy.lineage.predecessorPolicyHash, "policy.lineage.predecessorPolicyHash");
    requireValue(policy.lineage.predecessorPolicyHash !== `0x${"0".repeat(64)}`, "LineageMismatch", "policy.lineage.predecessorPolicyHash", "non-genesis epoch requires a nonzero predecessor");
  }
  requireValue(validFrom < validUntil, "ValidityWindow", "policy.lineage", "policy validity window is empty or reversed");

  requireValue(Array.isArray(policy.roles) && policy.roles.length === ROLE_ORDER.length, "RoleSet", "policy.roles", "policy must define exactly arbiter, pauser, and resolver");
  requireValue(policy.roles.every((role, index) => role?.role === ROLE_ORDER[index]), "RoleOrder", "policy.roles", "roles must be complete and sorted");
  const globalFingerprints = new Map();
  let memberCount = 0;
  for (const [roleIndex, role] of policy.roles.entries()) {
    const rolePath = `policy.roles[${roleIndex}]`;
    keys(role, ["role", "threshold", "members"], [], rolePath);
    const threshold = decimal(role.threshold, `${rolePath}.threshold`);
    requireValue(threshold >= 2n, "UnsafeThreshold", `${rolePath}.threshold`, "single-member authority is forbidden");
    requireValue(Array.isArray(role.members) && role.members.length >= 2 && role.members.length <= 7, "MemberCount", `${rolePath}.members`, "role requires two to seven members");
    requireValue(threshold <= BigInt(role.members.length), "InvalidThreshold", `${rolePath}.threshold`, "threshold exceeds role membership");
    requireValue(threshold * 2n > BigInt(role.members.length), "UnsafeThreshold", `${rolePath}.threshold`, "authority threshold must be a strict majority");
    const roleFingerprints = [];
    const custodyModes = new Set();
    for (const [memberIndex, member] of role.members.entries()) {
      const memberPath = `${rolePath}.members[${memberIndex}]`;
      keys(member, ["fingerprint", "custody"], [], memberPath);
      roleFingerprints.push(fingerprint(member.fingerprint, `${memberPath}.fingerprint`));
      requireValue(CUSTODY.has(member.custody), "Custody", `${memberPath}.custody`, "custody class is invalid");
      custodyModes.add(member.custody);
    }
    requireValue(new Set(roleFingerprints).size === roleFingerprints.length, "DuplicateMember", `${rolePath}.members`, "role contains a duplicate member");
    requireValue(roleFingerprints.every((value, index) => index === 0 || roleFingerprints[index - 1] < value), "MemberOrder", `${rolePath}.members`, "members must be sorted by fingerprint");
    requireValue(custodyModes.size >= 2, "CustodyConcentration", `${rolePath}.members`, "role must span at least two custody classes");
    for (const memberFingerprint of roleFingerprints) {
      requireValue(!globalFingerprints.has(memberFingerprint), "CrossRoleOverlap", `${rolePath}.members`, `member overlaps ${globalFingerprints.get(memberFingerprint)}`);
      globalFingerprints.set(memberFingerprint, role.role);
      memberCount += 1;
    }
  }

  requireValue(Array.isArray(policy.forbiddenCapabilities), "CapabilityBoundary", "policy.forbiddenCapabilities", "forbidden capability set is required");
  requireValue(canonicalizeValue(policy.forbiddenCapabilities) === canonicalizeValue(FORBIDDEN), "CapabilityBoundary", "policy.forbiddenCapabilities", "forbidden capability set drifted");

  keys(policy.rotation, ["minimumDelaySeconds", "maximumEpochSeconds"], [], "policy.rotation");
  const minimumDelay = uint64(policy.rotation.minimumDelaySeconds, "policy.rotation.minimumDelaySeconds");
  const maximumEpoch = uint64(policy.rotation.maximumEpochSeconds, "policy.rotation.maximumEpochSeconds");
  requireValue(minimumDelay >= 3600n, "RotationWindow", "policy.rotation.minimumDelaySeconds", "rotation delay is too short for review");
  requireValue(maximumEpoch > minimumDelay, "RotationWindow", "policy.rotation.maximumEpochSeconds", "maximum epoch must exceed rotation delay");
  requireValue(maximumEpoch <= MAX_EPOCH_SECONDS, "RotationWindow", "policy.rotation.maximumEpochSeconds", "maximum epoch cannot exceed one year");
  requireValue(validFrom >= announcedAt && validFrom - announcedAt >= minimumDelay, "RotationWindow", "policy.lineage.announcedAt", "policy was not announced for the declared review delay");
  requireValue(validUntil - validFrom <= maximumEpoch, "RotationWindow", "policy.lineage", "policy outlives its maximum epoch");

  if (context !== undefined) {
    validateContext(context);
    requireValue(context.expectedEpoch === policy.lineage.epoch, "StaleEpoch", "context.expectedEpoch", "policy epoch is not the expected epoch");
    requireValue(context.expectedPredecessorPolicyHash === policy.lineage.predecessorPolicyHash, "LineageMismatch", "context.expectedPredecessorPolicyHash", "policy predecessor does not match the accepted lineage");
    const observedAt = uint64(context.observedAt, "context.observedAt");
    requireValue(observedAt >= validFrom && observedAt < validUntil, "PolicyExpired", "context.observedAt", "policy is not active at the observation time");
  }

  const recomputedHash = authorityPolicyHash(policy);
  requireValue(recomputedHash === policy.policyHash, "PolicyHashMismatch", "policy.policyHash", "policy hash does not reproduce");
  return {
    schema: policy.schema,
    policyId: policy.policyId,
    policyHash: policy.policyHash,
    epoch: policy.lineage.epoch,
    roles: String(policy.roles.length),
    members: String(memberCount),
  };
}

function role(policy, name) {
  return policy.roles.find((candidate) => candidate.role === name);
}

function incidentRole(rolePolicy, unavailable) {
  const unavailableSet = new Set(unavailable);
  const remaining = rolePolicy.members.filter((member) => !unavailableSet.has(member.fingerprint));
  return {
    role: rolePolicy.role,
    unavailable: [...unavailable].sort(),
    remaining: String(remaining.length),
    threshold: rolePolicy.threshold,
    quorumAvailable: BigInt(remaining.length) >= BigInt(rolePolicy.threshold),
  };
}

export function evaluateIncidentMatrix(policy, context) {
  validateAuthorityPolicy(policy, context);
  const resolver = role(policy, "resolver");
  const arbiter = role(policy, "arbiter");
  const pauser = role(policy, "pauser");
  const memberLoss = incidentRole(resolver, [resolver.members[0].fingerprint]);
  const resolverThreshold = Number(BigInt(resolver.threshold));
  const lossCount = resolver.members.length - resolverThreshold + 1;
  const quorumLoss = incidentRole(
    resolver,
    resolver.members.slice(0, lossCount).map((member) => member.fingerprint),
  );
  const pauserLoss = incidentRole(pauser, pauser.members.map((member) => member.fingerprint));
  return {
    schema: "challenge-escrow.authority-incidents/v1",
    policyHash: policy.policyHash,
    scenarios: [
      {
        id: "member-loss",
        ...memberLoss,
        decision: memberLoss.quorumAvailable ? "continue-with-reduced-margin" : "fail-closed",
        requiredAction: "rotate-epoch-before-restoring-capacity",
      },
      {
        id: "signer-compromise",
        role: arbiter.role,
        compromised: [arbiter.members[0].fingerprint],
        decision: "fail-closed-rotate-epoch",
        blockedAction: "arbitration-under-current-epoch",
      },
      {
        id: "quorum-loss",
        ...quorumLoss,
        decision: "fail-closed",
        preservedExit: "contract-timeout-to-void",
      },
      {
        id: "pauser-loss",
        ...pauserLoss,
        decision: "degraded-exit-only",
        blockedAction: "new-pause-transition",
        preservedActions: ["claims", "disputes", "refunds", "timeouts"],
      },
      {
        id: "stale-policy-replay",
        presentedEpoch: String(BigInt(policy.lineage.epoch) - 1n),
        expectedEpoch: policy.lineage.epoch,
        decision: "rejected",
        reason: "epoch-and-predecessor-must-match",
      },
    ],
  };
}
