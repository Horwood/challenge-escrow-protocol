export const State = Object.freeze({
  OPEN: "OPEN",
  ACTIVE: "ACTIVE",
  PROPOSED: "PROPOSED",
  DISPUTED: "DISPUTED",
  CANCELLED: "CANCELLED",
  EXPIRED: "EXPIRED",
  RESOLVED_A: "RESOLVED_A",
  RESOLVED_B: "RESOLVED_B",
  VOID: "VOID",
});

export const Outcome = Object.freeze({ A: "A", B: "B", VOID: "VOID" });

const TERMINAL = new Set([
  State.CANCELLED,
  State.EXPIRED,
  State.RESOLVED_A,
  State.RESOLVED_B,
  State.VOID,
]);

const RESOLVED = new Set([State.RESOLVED_A, State.RESOLVED_B]);

export class ModelRejection extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

function reject(code) {
  throw new ModelRejection(code);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isOutcome(value) {
  return value === Outcome.A || value === Outcome.B || value === Outcome.VOID;
}

function winner(challenge, outcome) {
  const challengerWon =
    (challenge.challengerSide === "A" && outcome === Outcome.A) ||
    (challenge.challengerSide === "B" && outcome === Outcome.B);
  return challengerWon ? challenge.challenger : challenge.acceptor;
}

export class ChallengeModel {
  constructor({ resolver = "resolver", arbiter = "arbiter", pauser = "pauser" } = {}) {
    this.resolver = resolver;
    this.arbiter = arbiter;
    this.pauser = pauser;
    this.paused = false;
    this.totalOutstandingLiability = 0;
    this.challenges = new Map();
    this.usedNonces = new Set();
  }

  apply(action) {
    const before = this.snapshot();
    try {
      this.#apply(action);
      this.assertInvariants();
      return { ok: true, state: this.snapshot() };
    } catch (error) {
      const after = this.snapshot();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`MODEL_ATOMICITY_FAILURE:${error.code ?? error.message}`);
      }
      if (error instanceof ModelRejection) return { ok: false, error: error.code, state: after };
      throw error;
    }
  }

  assertInvariants() {
    let aggregate = 0;
    for (const challenge of this.challenges.values()) {
      if (!Object.values(State).includes(challenge.state)) {
        throw new Error(`MODEL_UNKNOWN_STATE:${challenge.state}`);
      }
      if (challenge.deposited !== challenge.outstanding + challenge.paid.challenger + challenge.paid.acceptor) {
        throw new Error(`MODEL_CHALLENGE_ACCOUNTING:${challenge.id}:${JSON.stringify({
          deposited: challenge.deposited,
          outstanding: challenge.outstanding,
          paid: challenge.paid,
          entitlements: challenge.entitlements,
          state: challenge.state,
        })}`);
      }
      if (challenge.outstanding < 0 || challenge.paid.challenger < 0 || challenge.paid.acceptor < 0) {
        throw new Error(`MODEL_NEGATIVE_ACCOUNTING:${challenge.id}`);
      }
      if (TERMINAL.has(challenge.state) && !challenge.final && ![State.CANCELLED, State.EXPIRED].includes(challenge.state)) {
        throw new Error(`MODEL_TERMINAL_WITHOUT_FINAL:${challenge.id}`);
      }
      if (RESOLVED.has(challenge.state)) {
        const expectedWinner = winner(challenge, challenge.final.outcome);
        if (challenge.entitlements[expectedWinner].claimable + challenge.entitlements[expectedWinner].paid !== challenge.stake * 2) {
          throw new Error(`MODEL_WINNER_ENTITLEMENT:${challenge.id}`);
        }
      }
      if (challenge.state === State.VOID) {
        if (challenge.acceptor === null) throw new Error(`MODEL_VOID_WITHOUT_ACCEPTOR:${challenge.id}`);
        for (const wallet of [challenge.challenger, challenge.acceptor]) {
          if (challenge.entitlements[wallet].claimable + challenge.entitlements[wallet].paid !== challenge.stake) {
            throw new Error(`MODEL_VOID_ENTITLEMENT:${challenge.id}:${wallet}`);
          }
        }
      }
      aggregate += challenge.outstanding;
    }
    if (aggregate !== this.totalOutstandingLiability) {
      throw new Error(`MODEL_TOTAL_LIABILITY:${aggregate}:${this.totalOutstandingLiability}`);
    }
  }

  snapshot() {
    return {
      paused: this.paused,
      totalOutstandingLiability: this.totalOutstandingLiability,
      challenges: [...this.challenges.values()].map((challenge) => clone(challenge)),
    };
  }

  #apply(action) {
    switch (action.type) {
      case "warp":
        return;
      case "pause":
        return this.#pause(action);
      case "create":
        return this.#create(action);
      case "advanceNonce":
        return this.#advanceNonce(action);
      case "accept":
        return this.#accept(action);
      case "cancel":
        return this.#cancel(action);
      case "expire":
        return this.#expire(action);
      case "propose":
        return this.#propose(action);
      case "dispute":
        return this.#dispute(action);
      case "finalize":
        return this.#finalize(action);
      case "arbitrate":
        return this.#arbitrate(action);
      case "voidUnproposed":
        return this.#voidUnproposed(action);
      case "voidUnarbitrated":
        return this.#voidUnarbitrated(action);
      case "claim":
        return this.#claim(action);
      case "refund":
        return this.#refund(action);
      default:
        reject("UnknownAction");
    }
  }

  #challenge(action) {
    const challenge = this.challenges.get(action.id);
    if (!challenge) reject("ChallengeNotFound");
    return challenge;
  }

  #pause(action) {
    if (action.caller !== this.pauser) reject("CallerNotPauser");
    if (action.paused === this.paused) reject("PauseStatusUnchanged");
    this.paused = action.paused;
  }

  #create(action) {
    if (this.paused) reject("ContractPaused");
    if (this.challenges.has(action.id)) reject("ChallengeAlreadyExists");
    if (this.usedNonces.has(`${action.challenger}:${action.nonce}`)) reject("InstanceNonceAlreadyUsed");
    if (action.caller !== action.challenger) reject("CallerNotChallenger");
    if (!action.nonce || action.stake <= 0 || action.stake > Number.MAX_SAFE_INTEGER / 2) reject("InvalidExecution");
    if (!(action.acceptanceDeadline > action.now && action.acceptanceDeadline < action.observationTime)) reject("InvalidDeadlines");
    if (!(action.observationTime < action.sourceCorrectionCutoff && action.sourceCorrectionCutoff < action.proposalDeadline)) reject("InvalidDeadlines");
    if (action.disputeWindow <= 0 || action.arbitrationWindow <= 0) reject("InvalidDeadlines");
    const latestProposalPath = action.proposalDeadline + action.disputeWindow + action.arbitrationWindow;
    const latestCorrectionPath = action.sourceCorrectionCutoff + action.arbitrationWindow;
    if (action.sourceCorrectionCutoff >= action.observationTime + action.disputeWindow || Math.max(latestProposalPath, latestCorrectionPath) > action.timeoutVoidAt) {
      reject("InvalidDeadlines");
    }
    const challenge = {
      id: action.id,
      challenger: action.challenger,
      acceptor: null,
      challengerSide: action.challengerSide,
      stake: action.stake,
      state: State.OPEN,
      acceptanceNonce: 0,
      deposited: action.stake,
      outstanding: action.stake,
      paid: { challenger: 0, acceptor: 0 },
      acceptanceDeadline: action.acceptanceDeadline,
      observationTime: action.observationTime,
      sourceCorrectionCutoff: action.sourceCorrectionCutoff,
      proposalDeadline: action.proposalDeadline,
      disputeWindow: action.disputeWindow,
      arbitrationWindow: action.arbitrationWindow,
      timeoutVoidAt: action.timeoutVoidAt,
      proposal: null,
      dispute: null,
      final: null,
      entitlements: { [action.challenger]: { claimable: 0, paid: 0 } },
    };
    this.challenges.set(action.id, challenge);
    this.usedNonces.add(`${action.challenger}:${action.nonce}`);
    this.totalOutstandingLiability += action.stake;
  }

  #advanceNonce(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.OPEN) reject("ChallengeNotOpen");
    if (action.caller !== challenge.challenger) reject("CallerNotChallenger");
    if (action.now >= challenge.acceptanceDeadline) reject("AcceptanceWindowClosed");
    challenge.acceptanceNonce += 1;
  }

  #accept(action) {
    if (this.paused) reject("ContractPaused");
    const challenge = this.#challenge(action);
    if (challenge.state !== State.OPEN) reject("ChallengeNotOpen");
    if (action.now >= challenge.acceptanceDeadline) reject("AcceptanceWindowClosed");
    if (action.caller !== action.acceptor) reject("CallerNotAcceptingWallet");
    if (!action.acceptor || action.acceptor === challenge.challenger || [this.resolver, this.arbiter, this.pauser].includes(action.acceptor)) reject("InvalidAcceptingWallet");
    if (action.permitNonce !== challenge.acceptanceNonce) reject("PermitNonceMismatch");
    if (!action.permitValid || action.expiresAt <= action.now || action.expiresAt > challenge.acceptanceDeadline) reject("InvalidPermit");
    challenge.acceptor = action.acceptor;
    challenge.deposited += challenge.stake;
    challenge.outstanding += challenge.stake;
    challenge.state = State.ACTIVE;
    challenge.entitlements[action.acceptor] = { claimable: 0, paid: 0 };
    this.totalOutstandingLiability += challenge.stake;
  }

  #cancel(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.OPEN) reject("ChallengeNotOpen");
    if (action.caller !== challenge.challenger) reject("CallerNotChallenger");
    if (action.now >= challenge.acceptanceDeadline) reject("AcceptanceWindowClosed");
    challenge.state = State.CANCELLED;
    challenge.entitlements[challenge.challenger].claimable = challenge.stake;
  }

  #expire(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.OPEN) reject("ChallengeNotOpen");
    if (action.now < challenge.acceptanceDeadline) reject("AcceptanceWindowOpen");
    challenge.state = State.EXPIRED;
    challenge.entitlements[challenge.challenger].claimable = challenge.stake;
  }

  #propose(action) {
    if (this.paused) reject("ContractPaused");
    const challenge = this.#challenge(action);
    if (challenge.state !== State.ACTIVE) reject("ChallengeNotActive");
    if (action.caller !== this.resolver) reject("CallerNotResolver");
    if (action.now < challenge.observationTime) reject("ObservationNotReached");
    if (action.now >= challenge.proposalDeadline) reject("ProposalWindowClosed");
    if (!action.evidenceHash || !isOutcome(action.outcome)) reject("InvalidProposal");
    if (action.outcome === Outcome.VOID && action.voidReason !== "TERMS_UNRESOLVABLE" && action.now < challenge.sourceCorrectionCutoff) reject("SourceCorrectionCutoffNotReached");
    challenge.proposal = {
      outcome: action.outcome,
      evidenceHash: action.evidenceHash,
      proposedAt: action.now,
      disputeDeadline: action.now + challenge.disputeWindow,
    };
    challenge.state = State.PROPOSED;
  }

  #dispute(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.PROPOSED) reject("ChallengeNotProposed");
    if (![challenge.challenger, challenge.acceptor].includes(action.caller)) reject("CallerNotParticipant");
    if (action.now >= challenge.proposal.disputeDeadline) reject("DisputeWindowClosed");
    if (action.outcome === challenge.proposal.outcome || !isOutcome(action.outcome)) reject("InvalidDispute");
    if (!action.evidenceHash || action.parentEvidenceHash !== challenge.proposal.evidenceHash) reject("InvalidEvidenceLineage");
    const arbitrationStart = Math.max(action.now, challenge.sourceCorrectionCutoff);
    challenge.dispute = {
      outcome: action.outcome,
      evidenceHash: action.evidenceHash,
      parentEvidenceHash: action.parentEvidenceHash,
      disputedAt: action.now,
      arbitrationStart,
      arbitrationDeadline: arbitrationStart + challenge.arbitrationWindow,
    };
    challenge.state = State.DISPUTED;
  }

  #finalize(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.PROPOSED) reject("ChallengeNotProposed");
    if (action.now < challenge.proposal.disputeDeadline) reject("DisputeDeadlineNotReached");
    this.#setFinal(challenge, challenge.proposal.outcome, challenge.proposal.evidenceHash);
  }

  #arbitrate(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.DISPUTED) reject("ChallengeNotDisputed");
    if (action.caller !== this.arbiter) reject("CallerNotArbiter");
    if (action.now < challenge.sourceCorrectionCutoff) reject("SourceCorrectionCutoffNotReached");
    if (action.now >= challenge.dispute.arbitrationDeadline) reject("ArbitrationWindowClosed");
    if (!action.evidenceHash || action.parentEvidenceHash !== challenge.dispute.evidenceHash || !isOutcome(action.outcome)) reject("InvalidEvidenceLineage");
    this.#setFinal(challenge, action.outcome, action.evidenceHash);
  }

  #voidUnproposed(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.ACTIVE) reject("ChallengeNotActive");
    if (action.now < challenge.proposalDeadline) reject("ProposalDeadlineNotReached");
    this.#setFinal(challenge, Outcome.VOID, null);
  }

  #voidUnarbitrated(action) {
    const challenge = this.#challenge(action);
    if (challenge.state !== State.DISPUTED) reject("ChallengeNotDisputed");
    if (action.now < challenge.dispute.arbitrationDeadline) reject("ArbitrationDeadlineNotReached");
    this.#setFinal(challenge, Outcome.VOID, null);
  }

  #setFinal(challenge, outcome, evidenceHash) {
    challenge.final = { outcome, evidenceHash };
    if (outcome === Outcome.VOID) {
      challenge.state = State.VOID;
      challenge.entitlements[challenge.challenger].claimable = challenge.stake;
      challenge.entitlements[challenge.acceptor].claimable = challenge.stake;
      return;
    }
    challenge.state = outcome === Outcome.A ? State.RESOLVED_A : State.RESOLVED_B;
    challenge.entitlements[winner(challenge, outcome)].claimable = challenge.stake * 2;
  }

  #claim(action) {
    const challenge = this.#challenge(action);
    if (!RESOLVED.has(challenge.state)) reject("ChallengeNotResolved");
    const wallet = winner(challenge, challenge.final.outcome);
    if (action.caller !== wallet) reject("CallerNotWinningWallet");
    this.#consume(challenge, wallet, challenge.stake * 2);
  }

  #refund(action) {
    const challenge = this.#challenge(action);
    if (![State.CANCELLED, State.EXPIRED, State.VOID].includes(challenge.state)) reject("ChallengeNotRefundable");
    const allowed = challenge.state === State.VOID
      ? [challenge.challenger, challenge.acceptor]
      : [challenge.challenger];
    if (!allowed.includes(action.caller)) reject("CallerNotRefundRecipient");
    this.#consume(challenge, action.caller, challenge.stake);
  }

  #consume(challenge, wallet, amount) {
    const entitlement = challenge.entitlements[wallet];
    if (!entitlement || entitlement.claimable !== amount || entitlement.paid !== 0) reject("InvalidEntitlement");
    if (challenge.outstanding < amount || this.totalOutstandingLiability < amount) reject("LiabilityAccountingMismatch");
    entitlement.claimable = 0;
    entitlement.paid = amount;
    if (wallet === challenge.challenger) challenge.paid.challenger += amount;
    if (wallet === challenge.acceptor) challenge.paid.acceptor += amount;
    challenge.outstanding -= amount;
    this.totalOutstandingLiability -= amount;
  }
}
