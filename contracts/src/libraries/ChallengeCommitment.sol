// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeTypes } from "../ChallengeTypes.sol";

/// @notice Typed execution and ordered composite commitment encodings.
library ChallengeCommitment {
    error ZeroExecutionHash();
    error ZeroTermsHash();

    string internal constant PROTOCOL_VERSION = "challenge-escrow-protocol/v1";
    string internal constant TERMS_DOMAIN = "challenge-escrow.terms/v1";
    string internal constant SPEC_DOMAIN = "challenge-escrow.spec/v1";
    string internal constant EVIDENCE_DOMAIN = "challenge-escrow.evidence/v1";
    bytes32 internal constant PROTOCOL_VERSION_HASH = keccak256(bytes(PROTOCOL_VERSION));
    bytes32 internal constant EXECUTION_TYPEHASH = keccak256(
        "ChallengeExecution(bytes32 protocolVersionHash,bytes32 nonce,uint64 createdAt,uint256 chainId,address escrowContract,address challengerWallet,uint8 challengerSide,address token,uint8 tokenDecimals,uint256 stakeAmount,uint64 acceptanceDeadline,uint64 observationTime,uint64 sourceCorrectionCutoff,uint64 proposalDeadline,uint64 disputeWindowSeconds,uint64 arbitrationWindowSeconds,uint64 timeoutVoidAt)"
    );

    function executionPreimage(ChallengeTypes.ChallengeExecution memory execution)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(EXECUTION_TYPEHASH, PROTOCOL_VERSION_HASH, execution);
    }

    function executionHash(ChallengeTypes.ChallengeExecution memory execution)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(executionPreimage(execution));
    }

    function specHash(bytes32 executionHash_, bytes32 termsHash_) internal pure returns (bytes32) {
        if (executionHash_ == bytes32(0)) revert ZeroExecutionHash();
        if (termsHash_ == bytes32(0)) revert ZeroTermsHash();
        return keccak256(abi.encodePacked(SPEC_DOMAIN, bytes1(0), executionHash_, termsHash_));
    }
}
