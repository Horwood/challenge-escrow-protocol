// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import { ChallengeTypes } from "./ChallengeTypes.sol";
import { AcceptancePermitHash } from "./libraries/AcceptancePermitHash.sol";
import { ChallengeCommitment } from "./libraries/ChallengeCommitment.sol";
import { ExactTokenDelta } from "./libraries/ExactTokenDelta.sol";
import { ChallengeIds } from "./libraries/ChallengeIds.sol";

/// @notice Research implementation of equal-stake challenge escrow and pull-based exits.
/// @dev Local/testnet-no-value candidate only. Production role administration is absent.
contract ChallengeEscrowKernel is ReentrancyGuard {
    struct ChallengeCreatedData {
        bytes32 specHash;
        bytes32 instanceNonce;
        ChallengeTypes.Side challengerSide;
        uint256 stakeAmount;
        uint256 acceptanceNonce;
        uint64 acceptanceDeadline;
        uint64 observationTime;
        uint64 sourceCorrectionCutoff;
        uint64 proposalDeadline;
        uint64 disputeWindowSeconds;
        uint64 arbitrationWindowSeconds;
        uint64 timeoutVoidAt;
        bytes32 executionHash;
        bytes32 termsHash;
        uint64 createdAt;
    }

    error ZeroCanonicalToken();
    error CanonicalTokenHasNoCode(address token);
    error CanonicalTokenEqualsEscrow();
    error ZeroResolver();
    error ZeroArbiter();
    error ResolverEqualsArbiter();
    error UnsupportedTokenDecimals(uint8 tokenDecimals);
    error ContractPaused();
    error ZeroInstanceNonce();
    error InvalidExecutionChain(uint256 supplied, uint256 expected);
    error InvalidExecutionEscrow(address supplied);
    error InvalidExecutionToken(address supplied);
    error InvalidExecutionTokenDecimals(uint8 supplied);
    error InvalidChallengerWallet(address supplied);
    error CallerNotChallenger(address caller);
    error InvalidStakeAmount(uint256 supplied);
    error CreatedAtAfterOpening(uint64 createdAt, uint64 openedAt);
    error InvalidAcceptanceDeadline();
    error InvalidObservationTime();
    error InvalidSourceCorrectionCutoff();
    error InvalidProposalDeadline();
    error InvalidDisputeWindow();
    error InvalidArbitrationWindow();
    error InvalidTimeoutVoidAt();
    error SpecHashMismatch(bytes32 supplied, bytes32 computed);
    error ChallengeAlreadyExists(bytes32 challengeId);
    error InstanceNonceAlreadyUsed(address challengerWallet, bytes32 instanceNonce);
    error ChallengeNotFound(bytes32 challengeId);
    error ChallengeNotOpen(bytes32 challengeId);
    error AcceptanceWindowClosed(uint64 acceptanceDeadline, uint64 currentTime);
    error CallerNotAcceptingWallet(address caller, address permitWallet);
    error InvalidAcceptingWallet(address supplied);
    error PermitChallengeIdMismatch(bytes32 supplied, bytes32 expected);
    error PermitSpecHashMismatch(bytes32 supplied, bytes32 expected);
    error PermitNonceMismatch(uint256 supplied, uint256 expected);
    error InvalidPermitExpiry(uint64 expiresAt, uint64 acceptanceDeadline, uint64 currentTime);
    error InvalidPermitSignature(ECDSA.RecoverError reason, bytes32 argument);
    error InvalidPermitSigner(address recovered, address expected);
    error ChallengeNotActive(bytes32 challengeId);
    error ChallengeNotProposed(bytes32 challengeId);
    error ChallengeNotDisputed(bytes32 challengeId);
    error CallerNotResolver(address caller);
    error CallerNotParticipant(address caller);
    error CallerNotArbiter(address caller);
    error ObservationNotReached(uint64 observationTime, uint64 currentTime);
    error ProposalWindowClosed(uint64 proposalDeadline, uint64 currentTime);
    error ProposalDeadlineNotReached(uint64 proposalDeadline, uint64 currentTime);
    error SourceCorrectionCutoffNotReached(uint64 sourceCorrectionCutoff, uint64 currentTime);
    error DisputeWindowClosed(uint64 disputeDeadline, uint64 currentTime);
    error DisputeDeadlineNotReached(uint64 disputeDeadline, uint64 currentTime);
    error ArbitrationWindowClosed(uint64 arbitrationDeadline, uint64 currentTime);
    error ArbitrationDeadlineNotReached(uint64 arbitrationDeadline, uint64 currentTime);
    error ZeroEvidenceHash();
    error InvalidOutcomeReason(ChallengeTypes.Outcome outcome, uint8 reasonCode);
    error ParentEvidenceHashMismatch(bytes32 supplied, bytes32 expected);
    error DisputeOutcomeUnchanged(ChallengeTypes.Outcome outcome);
    error ChallengeNotResolved(bytes32 challengeId);
    error ChallengeNotRefundable(bytes32 challengeId, ChallengeTypes.LifecycleState state);
    error CallerNotWinningWallet(address caller, address expected);
    error CallerNotRefundRecipient(address caller);
    error InvalidEntitlement(
        address wallet, uint256 claimableAmount, uint256 paidAmount, uint256 expectedAmount
    );
    error LiabilityAccountingMismatch(
        uint256 challengeLiability, uint256 aggregateLiability, uint256 paymentAmount
    );
    error EscrowInsolvent(uint256 balance, uint256 outstandingLiability);

    string public constant EVENT_PROTOCOL_ID = "challenge-escrow-event/v1";
    string public constant PROTOCOL_VERSION = "challenge-escrow-protocol/v1";
    string public constant CHALLENGE_SCHEMA_ID = "challenge-escrow.spec/v1";
    string public constant EVIDENCE_SCHEMA_ID = "challenge-escrow.evidence/v1";
    string public constant CONDITION_LANGUAGE_ID = "challenge-escrow.condition-language/v1";
    string public constant TERMS_DOMAIN = "challenge-escrow.terms/v1";
    string public constant SPEC_DOMAIN = "challenge-escrow.spec/v1";
    string public constant EVIDENCE_DOMAIN = "challenge-escrow.evidence/v1";
    string public constant EIP712_NAME = "Challenge Escrow";
    bytes32 public constant EXECUTION_TYPEHASH = ChallengeCommitment.EXECUTION_TYPEHASH;
    bytes32 public constant PROTOCOL_VERSION_HASH = ChallengeCommitment.PROTOCOL_VERSION_HASH;
    bytes32 private constant CHALLENGE_CREATED_EVENT_SIGNATURE = keccak256(
        "ChallengeCreated(bytes32,bytes32,bytes32,address,uint8,uint256,uint256,uint64,uint64,uint64,uint64,uint64,uint64,uint64,bytes32,bytes32,uint64)"
    );

    address public immutable canonicalToken;
    uint8 public immutable tokenDecimals;
    address public immutable resolver;
    address public immutable arbiter;
    bytes32 public immutable releaseId;
    bool public paused;
    uint256 public totalOutstandingLiability;

    mapping(bytes32 challengeId => ChallengeTypes.Challenge challenge) private _challenges;
    mapping(
        bytes32 challengeId => mapping(address wallet => ChallengeTypes.Entitlement entitlement)
    ) private _entitlements;
    mapping(address challengerWallet => mapping(bytes32 instanceNonce => bool used)) private
        _usedInstanceNonces;

    event ReleaseDeclared(
        bytes32 indexed releaseId,
        string eventProtocolId,
        string protocolVersion,
        string challengeSchemaId,
        string evidenceSchemaId,
        uint256 chainId,
        address escrowContract,
        address canonicalToken,
        uint8 tokenDecimals,
        ChallengeTypes.ValueMode valueMode,
        address resolver,
        address arbiter,
        bool initialPaused
    );

    event ChallengeCreated(
        bytes32 indexed challengeId,
        bytes32 specHash,
        bytes32 instanceNonce,
        address indexed challengerWallet,
        ChallengeTypes.Side challengerSide,
        uint256 stakeAmount,
        uint256 acceptanceNonce,
        uint64 acceptanceDeadline,
        uint64 observationTime,
        uint64 sourceCorrectionCutoff,
        uint64 proposalDeadline,
        uint64 disputeWindowSeconds,
        uint64 arbitrationWindowSeconds,
        uint64 timeoutVoidAt,
        bytes32 executionHash,
        bytes32 termsHash,
        uint64 createdAt
    );

    event AcceptanceNonceAdvanced(
        bytes32 indexed challengeId,
        address indexed challengerWallet,
        uint256 previousNonce,
        uint256 newNonce
    );

    event ChallengeAccepted(
        bytes32 indexed challengeId,
        address indexed acceptingWallet,
        ChallengeTypes.Side acceptingSide,
        uint256 consumedNonce,
        uint64 permitExpiresAt,
        uint256 stakeAmount
    );

    event ChallengeCancelled(
        bytes32 indexed challengeId, address indexed challengerWallet, uint256 refundAmount
    );

    event ChallengeExpired(
        bytes32 indexed challengeId,
        address materializedBy,
        address indexed challengerWallet,
        uint256 refundAmount
    );

    event OutcomeProposed(
        bytes32 indexed challengeId,
        address indexed resolver,
        ChallengeTypes.Outcome assertedOutcome,
        uint8 reasonCode,
        bytes32 evidenceHash,
        uint64 disputeDeadline
    );

    event OutcomeDisputed(
        bytes32 indexed challengeId,
        address indexed disputingWallet,
        ChallengeTypes.Outcome assertedOutcome,
        uint8 reasonCode,
        bytes32 evidenceHash,
        bytes32 parentEvidenceHash,
        uint64 arbitrationStart,
        uint64 arbitrationDeadline
    );

    event ChallengeResolved(
        bytes32 indexed challengeId,
        address indexed finalizedBy,
        ChallengeTypes.Outcome finalOutcome,
        uint8 reasonCode,
        bytes32 finalEvidenceHash,
        bytes32 parentEvidenceHash,
        ChallengeTypes.ResolutionPath resolutionPath,
        address indexed winnerWallet,
        uint256 claimAmount
    );

    event ChallengeVoided(
        bytes32 indexed challengeId,
        address indexed materializedBy,
        uint8 voidReason,
        bytes32 finalEvidenceHash,
        bytes32 parentEvidenceHash,
        ChallengeTypes.VoidPath voidPath,
        uint256 refundAmountEach
    );

    event WinningsClaimed(
        bytes32 indexed challengeId,
        bytes32 indexed entitlementId,
        address indexed wallet,
        uint256 amount
    );

    event PrincipalRefunded(
        bytes32 indexed challengeId,
        bytes32 indexed entitlementId,
        address indexed wallet,
        ChallengeTypes.LifecycleState originState,
        uint256 amount
    );

    constructor(
        address canonicalToken_,
        uint8 tokenDecimals_,
        address resolver_,
        address arbiter_,
        bool initialPaused_
    ) {
        if (canonicalToken_ == address(0)) revert ZeroCanonicalToken();
        if (canonicalToken_ == address(this)) revert CanonicalTokenEqualsEscrow();
        if (canonicalToken_.code.length == 0) revert CanonicalTokenHasNoCode(canonicalToken_);
        if (resolver_ == address(0)) revert ZeroResolver();
        if (arbiter_ == address(0)) revert ZeroArbiter();
        if (resolver_ == arbiter_) revert ResolverEqualsArbiter();
        if (tokenDecimals_ > 18) revert UnsupportedTokenDecimals(tokenDecimals_);

        canonicalToken = canonicalToken_;
        tokenDecimals = tokenDecimals_;
        resolver = resolver_;
        arbiter = arbiter_;
        paused = initialPaused_;
        releaseId = ChallengeIds.releaseId(block.chainid, address(this));

        emit ReleaseDeclared(
            releaseId,
            EVENT_PROTOCOL_ID,
            PROTOCOL_VERSION,
            CHALLENGE_SCHEMA_ID,
            EVIDENCE_SCHEMA_ID,
            block.chainid,
            address(this),
            canonicalToken_,
            tokenDecimals_,
            ChallengeTypes.ValueMode.TESTNET_NO_VALUE,
            resolver_,
            arbiter_,
            initialPaused_
        );
    }

    function createAndFund(
        ChallengeTypes.ChallengeExecution calldata execution,
        bytes32 termsHash,
        bytes32 suppliedSpecHash
    ) external nonReentrant returns (bytes32 challengeId) {
        if (paused) revert ContractPaused();
        uint64 openedAt = uint64(block.timestamp);
        _validateExecution(execution, openedAt);

        bytes32 executionHash = ChallengeCommitment.executionHash(execution);
        bytes32 specHash = ChallengeCommitment.specHash(executionHash, termsHash);
        if (suppliedSpecHash != specHash) revert SpecHashMismatch(suppliedSpecHash, specHash);
        challengeId = ChallengeIds.challengeId(specHash);

        if (_challenges[challengeId].exists) revert ChallengeAlreadyExists(challengeId);
        if (_usedInstanceNonces[execution.challengerWallet][execution.nonce]) {
            revert InstanceNonceAlreadyUsed(execution.challengerWallet, execution.nonce);
        }

        ExactTokenDelta.pullExact(canonicalToken, execution.challengerWallet, execution.stakeAmount);

        _usedInstanceNonces[execution.challengerWallet][execution.nonce] = true;
        totalOutstandingLiability += execution.stakeAmount;
        ChallengeTypes.Challenge storage challenge = _challenges[challengeId];
        challenge.exists = true;
        challenge.state = ChallengeTypes.LifecycleState.OPEN;
        challenge.specHash = specHash;
        challenge.executionHash = executionHash;
        challenge.termsHash = termsHash;
        challenge.instanceNonce = execution.nonce;
        challenge.challengerWallet = execution.challengerWallet;
        challenge.challengerSide = execution.challengerSide;
        challenge.stakeAmount = execution.stakeAmount;
        challenge.depositedAmount = execution.stakeAmount;
        challenge.outstandingLiability = execution.stakeAmount;
        challenge.openedAt = openedAt;
        challenge.createdAt = execution.createdAt;
        challenge.acceptanceDeadline = execution.acceptanceDeadline;
        challenge.observationTime = execution.observationTime;
        challenge.sourceCorrectionCutoff = execution.sourceCorrectionCutoff;
        challenge.proposalDeadline = execution.proposalDeadline;
        challenge.disputeWindowSeconds = execution.disputeWindowSeconds;
        challenge.arbitrationWindowSeconds = execution.arbitrationWindowSeconds;
        challenge.timeoutVoidAt = execution.timeoutVoidAt;

        _emitChallengeCreated(challengeId, challenge);
    }

    function accept(
        bytes32 challengeId,
        ChallengeTypes.AcceptancePermit calldata permit,
        bytes calldata signature
    ) external nonReentrant {
        if (paused) revert ContractPaused();
        ChallengeTypes.Challenge storage challenge = _openChallenge(challengeId);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime >= challenge.acceptanceDeadline) {
            revert AcceptanceWindowClosed(challenge.acceptanceDeadline, currentTime);
        }
        if (permit.challengeId != challengeId) {
            revert PermitChallengeIdMismatch(permit.challengeId, challengeId);
        }
        if (permit.specHash != challenge.specHash) {
            revert PermitSpecHashMismatch(permit.specHash, challenge.specHash);
        }
        if (msg.sender != permit.acceptingWallet) {
            revert CallerNotAcceptingWallet(msg.sender, permit.acceptingWallet);
        }
        _validateParticipantWallet(permit.acceptingWallet, challenge.challengerWallet);
        if (permit.acceptanceNonce != challenge.acceptanceNonce) {
            revert PermitNonceMismatch(permit.acceptanceNonce, challenge.acceptanceNonce);
        }
        if (
            currentTime >= permit.expiresAt || permit.expiresAt > challenge.acceptanceDeadline
                || permit.expiresAt == 0
        ) {
            revert InvalidPermitExpiry(permit.expiresAt, challenge.acceptanceDeadline, currentTime);
        }

        bytes32 digest = AcceptancePermitHash.digest(
            AcceptancePermitHash.domainSeparator(
                EIP712_NAME, PROTOCOL_VERSION, block.chainid, address(this)
            ),
            permit
        );
        (address recovered, ECDSA.RecoverError recoverError, bytes32 recoverErrorArgument) =
            ECDSA.tryRecoverCalldata(digest, signature);
        if (recoverError != ECDSA.RecoverError.NoError) {
            revert InvalidPermitSignature(recoverError, recoverErrorArgument);
        }
        if (recovered != challenge.challengerWallet) {
            revert InvalidPermitSigner(recovered, challenge.challengerWallet);
        }

        ExactTokenDelta.pullExact(canonicalToken, permit.acceptingWallet, challenge.stakeAmount);

        challenge.acceptingWallet = permit.acceptingWallet;
        challenge.acceptedAt = currentTime;
        challenge.depositedAmount += challenge.stakeAmount;
        challenge.outstandingLiability += challenge.stakeAmount;
        totalOutstandingLiability += challenge.stakeAmount;
        challenge.state = ChallengeTypes.LifecycleState.ACTIVE;

        ChallengeTypes.Side acceptingSide = challenge.challengerSide == ChallengeTypes.Side.A
            ? ChallengeTypes.Side.B
            : ChallengeTypes.Side.A;
        emit ChallengeAccepted(
            challengeId,
            permit.acceptingWallet,
            acceptingSide,
            permit.acceptanceNonce,
            permit.expiresAt,
            challenge.stakeAmount
        );
    }

    function advanceAcceptanceNonce(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _openChallenge(challengeId);
        if (msg.sender != challenge.challengerWallet) revert CallerNotChallenger(msg.sender);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime >= challenge.acceptanceDeadline) {
            revert AcceptanceWindowClosed(challenge.acceptanceDeadline, currentTime);
        }
        uint256 previousNonce = challenge.acceptanceNonce;
        challenge.acceptanceNonce = previousNonce + 1;
        emit AcceptanceNonceAdvanced(
            challengeId, challenge.challengerWallet, previousNonce, previousNonce + 1
        );
    }

    function cancelOpen(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _openChallenge(challengeId);
        if (msg.sender != challenge.challengerWallet) revert CallerNotChallenger(msg.sender);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime >= challenge.acceptanceDeadline) {
            revert AcceptanceWindowClosed(challenge.acceptanceDeadline, currentTime);
        }
        _createOpenRefund(challengeId, challenge, ChallengeTypes.LifecycleState.CANCELLED);
        emit ChallengeCancelled(challengeId, challenge.challengerWallet, challenge.stakeAmount);
    }

    function expireOpen(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _openChallenge(challengeId);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.acceptanceDeadline) {
            revert AcceptanceWindowClosed(challenge.acceptanceDeadline, currentTime);
        }
        _createOpenRefund(challengeId, challenge, ChallengeTypes.LifecycleState.EXPIRED);
        emit ChallengeExpired(
            challengeId, msg.sender, challenge.challengerWallet, challenge.stakeAmount
        );
    }

    function propose(
        bytes32 challengeId,
        ChallengeTypes.Outcome outcome,
        uint8 reasonCode,
        bytes32 evidenceHash
    ) external nonReentrant {
        if (paused) revert ContractPaused();
        ChallengeTypes.Challenge storage challenge = _activeChallenge(challengeId);
        if (msg.sender != resolver) revert CallerNotResolver(msg.sender);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.observationTime) {
            revert ObservationNotReached(challenge.observationTime, currentTime);
        }
        if (currentTime >= challenge.proposalDeadline) {
            revert ProposalWindowClosed(challenge.proposalDeadline, currentTime);
        }
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        (ChallengeTypes.ABReason abReason, ChallengeTypes.EvidenceVoidReason voidReason) =
            _validateReason(outcome, reasonCode);
        if (
            outcome == ChallengeTypes.Outcome.VOID
                && voidReason != ChallengeTypes.EvidenceVoidReason.TERMS_UNRESOLVABLE
                && currentTime < challenge.sourceCorrectionCutoff
        ) {
            revert SourceCorrectionCutoffNotReached(challenge.sourceCorrectionCutoff, currentTime);
        }

        uint64 disputeDeadline = currentTime + challenge.disputeWindowSeconds;
        challenge.proposal = ChallengeTypes.Proposal({
            exists: true,
            outcome: outcome,
            abReason: abReason,
            evidenceVoidReason: voidReason,
            evidenceHash: evidenceHash,
            proposedAt: currentTime,
            disputeDeadline: disputeDeadline
        });
        challenge.state = ChallengeTypes.LifecycleState.PROPOSED;
        emit OutcomeProposed(
            challengeId, resolver, outcome, reasonCode, evidenceHash, disputeDeadline
        );
    }

    function dispute(
        bytes32 challengeId,
        ChallengeTypes.Outcome outcome,
        uint8 reasonCode,
        bytes32 evidenceHash,
        bytes32 parentEvidenceHash
    ) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _proposedChallenge(challengeId);
        if (msg.sender != challenge.challengerWallet && msg.sender != challenge.acceptingWallet) {
            revert CallerNotParticipant(msg.sender);
        }
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime >= challenge.proposal.disputeDeadline) {
            revert DisputeWindowClosed(challenge.proposal.disputeDeadline, currentTime);
        }
        if (outcome == challenge.proposal.outcome) revert DisputeOutcomeUnchanged(outcome);
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        if (parentEvidenceHash != challenge.proposal.evidenceHash) {
            revert ParentEvidenceHashMismatch(parentEvidenceHash, challenge.proposal.evidenceHash);
        }
        (ChallengeTypes.ABReason abReason, ChallengeTypes.EvidenceVoidReason voidReason) =
            _validateReason(outcome, reasonCode);
        uint64 arbitrationStart = currentTime < challenge.sourceCorrectionCutoff
            ? challenge.sourceCorrectionCutoff
            : currentTime;
        uint64 arbitrationDeadline = arbitrationStart + challenge.arbitrationWindowSeconds;

        challenge.dispute = ChallengeTypes.Dispute({
            exists: true,
            disputingWallet: msg.sender,
            outcome: outcome,
            abReason: abReason,
            evidenceVoidReason: voidReason,
            evidenceHash: evidenceHash,
            parentEvidenceHash: parentEvidenceHash,
            disputedAt: currentTime,
            arbitrationStart: arbitrationStart,
            arbitrationDeadline: arbitrationDeadline
        });
        challenge.state = ChallengeTypes.LifecycleState.DISPUTED;
        emit OutcomeDisputed(
            challengeId,
            msg.sender,
            outcome,
            reasonCode,
            evidenceHash,
            parentEvidenceHash,
            arbitrationStart,
            arbitrationDeadline
        );
    }

    function finalizeUncontested(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _proposedChallenge(challengeId);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.proposal.disputeDeadline) {
            revert DisputeDeadlineNotReached(challenge.proposal.disputeDeadline, currentTime);
        }

        if (challenge.proposal.outcome == ChallengeTypes.Outcome.VOID) {
            _finalizeEvidenceVoid(
                challengeId,
                challenge,
                challenge.proposal.evidenceVoidReason,
                challenge.proposal.evidenceHash,
                bytes32(0),
                ChallengeTypes.VoidPath.UNCONTESTED,
                msg.sender
            );
        } else {
            _finalizeResolved(
                challengeId,
                challenge,
                challenge.proposal.outcome,
                challenge.proposal.abReason,
                challenge.proposal.evidenceHash,
                bytes32(0),
                ChallengeTypes.ResolutionPath.UNCONTESTED,
                msg.sender
            );
        }
    }

    function arbitrate(
        bytes32 challengeId,
        ChallengeTypes.Outcome outcome,
        uint8 reasonCode,
        bytes32 evidenceHash,
        bytes32 parentEvidenceHash
    ) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _disputedChallenge(challengeId);
        if (msg.sender != arbiter) revert CallerNotArbiter(msg.sender);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.sourceCorrectionCutoff) {
            revert SourceCorrectionCutoffNotReached(challenge.sourceCorrectionCutoff, currentTime);
        }
        if (currentTime >= challenge.dispute.arbitrationDeadline) {
            revert ArbitrationWindowClosed(challenge.dispute.arbitrationDeadline, currentTime);
        }
        if (evidenceHash == bytes32(0)) revert ZeroEvidenceHash();
        if (parentEvidenceHash != challenge.dispute.evidenceHash) {
            revert ParentEvidenceHashMismatch(parentEvidenceHash, challenge.dispute.evidenceHash);
        }
        (ChallengeTypes.ABReason abReason, ChallengeTypes.EvidenceVoidReason voidReason) =
            _validateReason(outcome, reasonCode);

        if (outcome == ChallengeTypes.Outcome.VOID) {
            _finalizeEvidenceVoid(
                challengeId,
                challenge,
                voidReason,
                evidenceHash,
                parentEvidenceHash,
                ChallengeTypes.VoidPath.ARBITER,
                msg.sender
            );
        } else {
            _finalizeResolved(
                challengeId,
                challenge,
                outcome,
                abReason,
                evidenceHash,
                parentEvidenceHash,
                ChallengeTypes.ResolutionPath.ARBITER,
                msg.sender
            );
        }
    }

    function voidUnproposed(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _activeChallenge(challengeId);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.proposalDeadline) {
            revert ProposalDeadlineNotReached(challenge.proposalDeadline, currentTime);
        }
        _finalizeTimeoutVoid(
            challengeId,
            challenge,
            ChallengeTypes.TimeoutVoidReason.NO_PROPOSAL_TIMEOUT,
            ChallengeTypes.VoidPath.PROPOSAL_TIMEOUT,
            msg.sender
        );
    }

    function voidUnarbitrated(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _disputedChallenge(challengeId);
        uint64 currentTime = uint64(block.timestamp);
        if (currentTime < challenge.dispute.arbitrationDeadline) {
            revert ArbitrationDeadlineNotReached(challenge.dispute.arbitrationDeadline, currentTime);
        }
        _finalizeTimeoutVoid(
            challengeId,
            challenge,
            ChallengeTypes.TimeoutVoidReason.ARBITRATION_TIMEOUT,
            ChallengeTypes.VoidPath.ARBITRATION_TIMEOUT,
            msg.sender
        );
    }

    function claimWinnings(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        if (
            challenge.state != ChallengeTypes.LifecycleState.RESOLVED_A
                && challenge.state != ChallengeTypes.LifecycleState.RESOLVED_B
        ) revert ChallengeNotResolved(challengeId);

        address winnerWallet = _winnerWallet(challenge, challenge.finalResolution.outcome);
        if (msg.sender != winnerWallet) {
            revert CallerNotWinningWallet(msg.sender, winnerWallet);
        }
        uint256 amount = challenge.stakeAmount * 2;
        bytes32 entitlementId = _consumeAndPay(challengeId, challenge, msg.sender, amount);
        emit WinningsClaimed(challengeId, entitlementId, msg.sender, amount);
    }

    function refundPrincipal(bytes32 challengeId) external nonReentrant {
        ChallengeTypes.Challenge storage challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        ChallengeTypes.LifecycleState originState = challenge.state;
        bool openTerminal = originState == ChallengeTypes.LifecycleState.CANCELLED
            || originState == ChallengeTypes.LifecycleState.EXPIRED;
        bool acceptedTerminal = originState == ChallengeTypes.LifecycleState.VOID;
        if (!openTerminal && !acceptedTerminal) {
            revert ChallengeNotRefundable(challengeId, originState);
        }
        if (
            (openTerminal && msg.sender != challenge.challengerWallet)
                || (acceptedTerminal
                    && msg.sender != challenge.challengerWallet
                    && msg.sender != challenge.acceptingWallet)
        ) revert CallerNotRefundRecipient(msg.sender);

        uint256 amount = challenge.stakeAmount;
        bytes32 entitlementId = _consumeAndPay(challengeId, challenge, msg.sender, amount);
        emit PrincipalRefunded(challengeId, entitlementId, msg.sender, originState, amount);
    }

    function domainSeparator() external view returns (bytes32) {
        return AcceptancePermitHash.domainSeparator(
            EIP712_NAME, PROTOCOL_VERSION, block.chainid, address(this)
        );
    }

    function acceptancePermitTypeHash() external pure returns (bytes32) {
        return AcceptancePermitHash.PERMIT_TYPEHASH;
    }

    function hashAcceptancePermit(ChallengeTypes.AcceptancePermit calldata permit)
        external
        view
        returns (bytes32)
    {
        return AcceptancePermitHash.digest(
            AcceptancePermitHash.domainSeparator(
                EIP712_NAME, PROTOCOL_VERSION, block.chainid, address(this)
            ),
            permit
        );
    }

    function computeExecutionHash(ChallengeTypes.ChallengeExecution calldata execution)
        external
        pure
        returns (bytes32)
    {
        return ChallengeCommitment.executionHash(execution);
    }

    function computeSpecHash(bytes32 executionHash_, bytes32 termsHash_)
        external
        pure
        returns (bytes32)
    {
        return ChallengeCommitment.specHash(executionHash_, termsHash_);
    }

    function computeChallengeId(bytes32 specHash) external pure returns (bytes32) {
        return ChallengeIds.challengeId(specHash);
    }

    function computeEntitlementId(bytes32 challengeId_, address participantWallet)
        external
        pure
        returns (bytes32)
    {
        return ChallengeIds.entitlementId(challengeId_, participantWallet);
    }

    function getChallenge(bytes32 challengeId_)
        external
        view
        returns (ChallengeTypes.Challenge memory)
    {
        return _challenges[challengeId_];
    }

    function getEntitlement(bytes32 challengeId_, address wallet)
        external
        view
        returns (ChallengeTypes.Entitlement memory)
    {
        return _entitlements[challengeId_][wallet];
    }

    function instanceNonceUsed(address challengerWallet, bytes32 instanceNonce)
        external
        view
        returns (bool)
    {
        return _usedInstanceNonces[challengerWallet][instanceNonce];
    }

    function _validateExecution(
        ChallengeTypes.ChallengeExecution calldata execution,
        uint64 openedAt
    ) private view {
        if (execution.nonce == bytes32(0)) {
            revert ZeroInstanceNonce();
        }
        if (execution.chainId != block.chainid) {
            revert InvalidExecutionChain(execution.chainId, block.chainid);
        }
        if (execution.escrowContract != address(this)) {
            revert InvalidExecutionEscrow(execution.escrowContract);
        }
        if (execution.token != canonicalToken) revert InvalidExecutionToken(execution.token);
        if (execution.tokenDecimals != tokenDecimals) {
            revert InvalidExecutionTokenDecimals(execution.tokenDecimals);
        }
        _validateChallengerWallet(execution.challengerWallet);
        if (msg.sender != execution.challengerWallet) revert CallerNotChallenger(msg.sender);
        if (execution.stakeAmount == 0 || execution.stakeAmount > type(uint256).max / 2) {
            revert InvalidStakeAmount(execution.stakeAmount);
        }
        if (execution.createdAt > openedAt) {
            revert CreatedAtAfterOpening(execution.createdAt, openedAt);
        }
        if (openedAt >= execution.acceptanceDeadline) revert InvalidAcceptanceDeadline();
        if (execution.acceptanceDeadline >= execution.observationTime) {
            revert InvalidObservationTime();
        }
        if (execution.observationTime >= execution.proposalDeadline) {
            revert InvalidProposalDeadline();
        }
        if (execution.disputeWindowSeconds == 0) revert InvalidDisputeWindow();
        if (execution.arbitrationWindowSeconds == 0) revert InvalidArbitrationWindow();
        if (
            execution.observationTime >= execution.sourceCorrectionCutoff
                || execution.sourceCorrectionCutoff >= execution.proposalDeadline
        ) revert InvalidSourceCorrectionCutoff();

        uint256 latestDisputeEnd =
            uint256(execution.observationTime) + execution.disputeWindowSeconds;
        if (uint256(execution.sourceCorrectionCutoff) >= latestDisputeEnd) {
            revert InvalidSourceCorrectionCutoff();
        }
        uint256 latestProposalPath = uint256(execution.proposalDeadline)
            + execution.disputeWindowSeconds + execution.arbitrationWindowSeconds;
        uint256 latestCorrectionPath =
            uint256(execution.sourceCorrectionCutoff) + execution.arbitrationWindowSeconds;
        if (
            latestProposalPath > execution.timeoutVoidAt
                || latestCorrectionPath > execution.timeoutVoidAt
        ) revert InvalidTimeoutVoidAt();
    }

    function _validateChallengerWallet(address wallet) internal view virtual {
        if (
            wallet == address(0) || wallet == address(this) || wallet == canonicalToken
                || wallet == resolver || wallet == arbiter
        ) revert InvalidChallengerWallet(wallet);
    }

    function _validateParticipantWallet(address wallet, address challengerWallet)
        internal
        view
        virtual
    {
        if (
            wallet == address(0) || wallet == address(this) || wallet == canonicalToken
                || wallet == resolver || wallet == arbiter || wallet == challengerWallet
        ) revert InvalidAcceptingWallet(wallet);
    }

    function _openChallenge(bytes32 challengeId)
        private
        view
        returns (ChallengeTypes.Challenge storage challenge)
    {
        challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        if (challenge.state != ChallengeTypes.LifecycleState.OPEN) {
            revert ChallengeNotOpen(challengeId);
        }
    }

    function _activeChallenge(bytes32 challengeId)
        private
        view
        returns (ChallengeTypes.Challenge storage challenge)
    {
        challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        if (challenge.state != ChallengeTypes.LifecycleState.ACTIVE) {
            revert ChallengeNotActive(challengeId);
        }
    }

    function _proposedChallenge(bytes32 challengeId)
        private
        view
        returns (ChallengeTypes.Challenge storage challenge)
    {
        challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        if (challenge.state != ChallengeTypes.LifecycleState.PROPOSED) {
            revert ChallengeNotProposed(challengeId);
        }
    }

    function _disputedChallenge(bytes32 challengeId)
        private
        view
        returns (ChallengeTypes.Challenge storage challenge)
    {
        challenge = _challenges[challengeId];
        if (!challenge.exists) revert ChallengeNotFound(challengeId);
        if (challenge.state != ChallengeTypes.LifecycleState.DISPUTED) {
            revert ChallengeNotDisputed(challengeId);
        }
    }

    function _validateReason(ChallengeTypes.Outcome outcome, uint8 reasonCode)
        private
        pure
        returns (ChallengeTypes.ABReason abReason, ChallengeTypes.EvidenceVoidReason voidReason)
    {
        if (outcome == ChallengeTypes.Outcome.VOID) {
            if (reasonCode > uint8(type(ChallengeTypes.EvidenceVoidReason).max)) {
                revert InvalidOutcomeReason(outcome, reasonCode);
            }
            voidReason = ChallengeTypes.EvidenceVoidReason(reasonCode);
        } else {
            if (reasonCode > uint8(type(ChallengeTypes.ABReason).max)) {
                revert InvalidOutcomeReason(outcome, reasonCode);
            }
            abReason = ChallengeTypes.ABReason(reasonCode);
        }
    }

    function _finalizeResolved(
        bytes32 challengeId,
        ChallengeTypes.Challenge storage challenge,
        ChallengeTypes.Outcome outcome,
        ChallengeTypes.ABReason reason,
        bytes32 evidenceHash,
        bytes32 parentEvidenceHash,
        ChallengeTypes.ResolutionPath path,
        address finalizedBy
    ) private {
        challenge.state = outcome == ChallengeTypes.Outcome.A
            ? ChallengeTypes.LifecycleState.RESOLVED_A
            : ChallengeTypes.LifecycleState.RESOLVED_B;
        challenge.finalResolution = ChallengeTypes.FinalResolution({
            exists: true,
            outcome: outcome,
            abReason: reason,
            evidenceVoidReason: ChallengeTypes.EvidenceVoidReason.SOURCE_UNAVAILABLE,
            timeoutVoidReason: ChallengeTypes.TimeoutVoidReason.NO_PROPOSAL_TIMEOUT,
            resolutionPath: path,
            voidPath: ChallengeTypes.VoidPath.UNCONTESTED,
            finalEvidenceHash: evidenceHash,
            parentEvidenceHash: parentEvidenceHash,
            finalizedBy: finalizedBy
        });
        address winnerWallet = _winnerWallet(challenge, outcome);
        uint256 claimAmount = challenge.stakeAmount * 2;
        ChallengeTypes.Entitlement storage entitlement = _entitlements[challengeId][winnerWallet];
        entitlement.exists = true;
        entitlement.claimableAmount = claimAmount;
        emit ChallengeResolved(
            challengeId,
            finalizedBy,
            outcome,
            uint8(reason),
            evidenceHash,
            parentEvidenceHash,
            path,
            winnerWallet,
            claimAmount
        );
    }

    function _finalizeEvidenceVoid(
        bytes32 challengeId,
        ChallengeTypes.Challenge storage challenge,
        ChallengeTypes.EvidenceVoidReason reason,
        bytes32 evidenceHash,
        bytes32 parentEvidenceHash,
        ChallengeTypes.VoidPath path,
        address finalizedBy
    ) private {
        challenge.state = ChallengeTypes.LifecycleState.VOID;
        challenge.finalResolution = ChallengeTypes.FinalResolution({
            exists: true,
            outcome: ChallengeTypes.Outcome.VOID,
            abReason: ChallengeTypes.ABReason.PRIMARY_OBSERVATION,
            evidenceVoidReason: reason,
            timeoutVoidReason: ChallengeTypes.TimeoutVoidReason.NO_PROPOSAL_TIMEOUT,
            resolutionPath: ChallengeTypes.ResolutionPath.UNCONTESTED,
            voidPath: path,
            finalEvidenceHash: evidenceHash,
            parentEvidenceHash: parentEvidenceHash,
            finalizedBy: finalizedBy
        });
        _createAcceptedRefunds(challengeId, challenge);
        emit ChallengeVoided(
            challengeId,
            finalizedBy,
            uint8(reason),
            evidenceHash,
            parentEvidenceHash,
            path,
            challenge.stakeAmount
        );
    }

    function _finalizeTimeoutVoid(
        bytes32 challengeId,
        ChallengeTypes.Challenge storage challenge,
        ChallengeTypes.TimeoutVoidReason reason,
        ChallengeTypes.VoidPath path,
        address finalizedBy
    ) private {
        challenge.state = ChallengeTypes.LifecycleState.VOID;
        challenge.finalResolution = ChallengeTypes.FinalResolution({
            exists: true,
            outcome: ChallengeTypes.Outcome.VOID,
            abReason: ChallengeTypes.ABReason.PRIMARY_OBSERVATION,
            evidenceVoidReason: ChallengeTypes.EvidenceVoidReason.SOURCE_UNAVAILABLE,
            timeoutVoidReason: reason,
            resolutionPath: ChallengeTypes.ResolutionPath.UNCONTESTED,
            voidPath: path,
            finalEvidenceHash: bytes32(0),
            parentEvidenceHash: bytes32(0),
            finalizedBy: finalizedBy
        });
        _createAcceptedRefunds(challengeId, challenge);
        emit ChallengeVoided(
            challengeId,
            finalizedBy,
            uint8(reason),
            bytes32(0),
            bytes32(0),
            path,
            challenge.stakeAmount
        );
    }

    function _createAcceptedRefunds(bytes32 challengeId, ChallengeTypes.Challenge storage challenge)
        private
    {
        ChallengeTypes.Entitlement storage challengerEntitlement =
            _entitlements[challengeId][challenge.challengerWallet];
        challengerEntitlement.exists = true;
        challengerEntitlement.claimableAmount = challenge.stakeAmount;
        ChallengeTypes.Entitlement storage acceptingEntitlement =
            _entitlements[challengeId][challenge.acceptingWallet];
        acceptingEntitlement.exists = true;
        acceptingEntitlement.claimableAmount = challenge.stakeAmount;
    }

    function _consumeAndPay(
        bytes32 challengeId,
        ChallengeTypes.Challenge storage challenge,
        address wallet,
        uint256 amount
    ) private returns (bytes32 entitlementId) {
        ChallengeTypes.Entitlement storage entitlement = _entitlements[challengeId][wallet];
        if (
            !entitlement.exists || entitlement.claimableAmount != amount
                || entitlement.paidAmount != 0
        ) {
            revert InvalidEntitlement(
                wallet, entitlement.claimableAmount, entitlement.paidAmount, amount
            );
        }
        uint256 aggregateLiability = totalOutstandingLiability;
        if (challenge.outstandingLiability < amount || aggregateLiability < amount) {
            revert LiabilityAccountingMismatch(
                challenge.outstandingLiability, aggregateLiability, amount
            );
        }
        uint256 escrowBalance = ExactTokenDelta.balanceOf(canonicalToken, address(this));
        if (escrowBalance < aggregateLiability) {
            revert EscrowInsolvent(escrowBalance, aggregateLiability);
        }

        entitlement.claimableAmount = 0;
        entitlement.paidAmount = amount;
        challenge.outstandingLiability -= amount;
        totalOutstandingLiability = aggregateLiability - amount;
        uint256 afterEscrowBalance = ExactTokenDelta.pushExact(canonicalToken, wallet, amount);
        if (afterEscrowBalance < totalOutstandingLiability) {
            revert EscrowInsolvent(afterEscrowBalance, totalOutstandingLiability);
        }
        entitlementId = ChallengeIds.entitlementId(challengeId, wallet);
    }

    function _winnerWallet(
        ChallengeTypes.Challenge storage challenge,
        ChallengeTypes.Outcome outcome
    ) private view returns (address) {
        bool challengerWon =
            (challenge.challengerSide == ChallengeTypes.Side.A
                    && outcome == ChallengeTypes.Outcome.A)
                || (challenge.challengerSide == ChallengeTypes.Side.B
                    && outcome == ChallengeTypes.Outcome.B);
        return challengerWon ? challenge.challengerWallet : challenge.acceptingWallet;
    }

    function _createOpenRefund(
        bytes32 challengeId,
        ChallengeTypes.Challenge storage challenge,
        ChallengeTypes.LifecycleState terminalState
    ) private {
        challenge.state = terminalState;
        ChallengeTypes.Entitlement storage entitlement =
            _entitlements[challengeId][challenge.challengerWallet];
        entitlement.exists = true;
        entitlement.claimableAmount = challenge.stakeAmount;
    }

    function _emitChallengeCreated(bytes32 challengeId, ChallengeTypes.Challenge storage challenge)
        private
    {
        ChallengeCreatedData memory payload;
        payload.specHash = challenge.specHash;
        payload.instanceNonce = challenge.instanceNonce;
        payload.challengerSide = challenge.challengerSide;
        payload.stakeAmount = challenge.stakeAmount;
        payload.acceptanceNonce = challenge.acceptanceNonce;
        payload.acceptanceDeadline = challenge.acceptanceDeadline;
        payload.observationTime = challenge.observationTime;
        payload.sourceCorrectionCutoff = challenge.sourceCorrectionCutoff;
        payload.proposalDeadline = challenge.proposalDeadline;
        payload.disputeWindowSeconds = challenge.disputeWindowSeconds;
        payload.arbitrationWindowSeconds = challenge.arbitrationWindowSeconds;
        payload.timeoutVoidAt = challenge.timeoutVoidAt;
        payload.executionHash = challenge.executionHash;
        payload.termsHash = challenge.termsHash;
        payload.createdAt = challenge.createdAt;
        bytes memory encoded = abi.encode(payload);
        bytes32 signature = CHALLENGE_CREATED_EVENT_SIGNATURE;
        address challengerWallet = challenge.challengerWallet;
        assembly ("memory-safe") {
            log3(add(encoded, 0x20), mload(encoded), signature, challengeId, challengerWallet)
        }
    }
}
