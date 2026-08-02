// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Canonical protocol ABI and storage types. This library contains no behavior.
library ChallengeTypes {
    enum LifecycleState {
        OPEN,
        ACTIVE,
        PROPOSED,
        DISPUTED,
        CANCELLED,
        EXPIRED,
        RESOLVED_A,
        RESOLVED_B,
        VOID
    }

    enum Side {
        A,
        B
    }

    enum Outcome {
        A,
        B,
        VOID
    }

    enum ValueMode {
        TESTNET_NO_VALUE
    }

    enum ABReason {
        PRIMARY_OBSERVATION,
        FALLBACK_OBSERVATION,
        CORRECTED_PRIMARY_OBSERVATION,
        CORRECTED_FALLBACK_OBSERVATION
    }

    enum EvidenceVoidReason {
        SOURCE_UNAVAILABLE,
        INSUFFICIENT_DATA,
        INVALID_OBSERVATION,
        AMBIGUOUS_SOURCE_RECORD,
        EVIDENCE_UNAVAILABLE,
        TERMS_UNRESOLVABLE
    }

    enum TimeoutVoidReason {
        NO_PROPOSAL_TIMEOUT,
        ARBITRATION_TIMEOUT
    }

    enum ResolutionPath {
        UNCONTESTED,
        ARBITER
    }

    enum VoidPath {
        UNCONTESTED,
        ARBITER,
        PROPOSAL_TIMEOUT,
        ARBITRATION_TIMEOUT
    }

    struct AcceptancePermit {
        bytes32 challengeId;
        bytes32 specHash;
        address acceptingWallet;
        uint256 acceptanceNonce;
        uint64 expiresAt;
    }

    /// @dev The 16 caller-supplied fields in the typed execution commitment.
    struct ChallengeExecution {
        bytes32 nonce;
        uint64 createdAt;
        uint256 chainId;
        address escrowContract;
        address challengerWallet;
        Side challengerSide;
        address token;
        uint8 tokenDecimals;
        uint256 stakeAmount;
        uint64 acceptanceDeadline;
        uint64 observationTime;
        uint64 sourceCorrectionCutoff;
        uint64 proposalDeadline;
        uint64 disputeWindowSeconds;
        uint64 arbitrationWindowSeconds;
        uint64 timeoutVoidAt;
    }

    struct Proposal {
        bool exists;
        Outcome outcome;
        ABReason abReason;
        EvidenceVoidReason evidenceVoidReason;
        bytes32 evidenceHash;
        uint64 proposedAt;
        uint64 disputeDeadline;
    }

    struct Dispute {
        bool exists;
        address disputingWallet;
        Outcome outcome;
        ABReason abReason;
        EvidenceVoidReason evidenceVoidReason;
        bytes32 evidenceHash;
        bytes32 parentEvidenceHash;
        uint64 disputedAt;
        uint64 arbitrationStart;
        uint64 arbitrationDeadline;
    }

    struct FinalResolution {
        bool exists;
        Outcome outcome;
        ABReason abReason;
        EvidenceVoidReason evidenceVoidReason;
        TimeoutVoidReason timeoutVoidReason;
        ResolutionPath resolutionPath;
        VoidPath voidPath;
        bytes32 finalEvidenceHash;
        bytes32 parentEvidenceHash;
        address finalizedBy;
    }

    struct Challenge {
        bool exists;
        LifecycleState state;
        bytes32 specHash;
        bytes32 executionHash;
        bytes32 termsHash;
        bytes32 instanceNonce;
        address challengerWallet;
        address acceptingWallet;
        Side challengerSide;
        uint256 stakeAmount;
        uint256 acceptanceNonce;
        uint256 depositedAmount;
        uint256 outstandingLiability;
        uint64 openedAt;
        uint64 createdAt;
        uint64 acceptedAt;
        uint64 acceptanceDeadline;
        uint64 observationTime;
        uint64 sourceCorrectionCutoff;
        uint64 proposalDeadline;
        uint64 disputeWindowSeconds;
        uint64 arbitrationWindowSeconds;
        uint64 timeoutVoidAt;
        Proposal proposal;
        Dispute dispute;
        FinalResolution finalResolution;
    }

    struct Entitlement {
        bool exists;
        uint256 claimableAmount;
        uint256 paidAmount;
    }
}
