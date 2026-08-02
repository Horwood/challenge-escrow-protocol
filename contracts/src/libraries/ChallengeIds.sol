// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

/// @notice Domain-separated release, challenge, and entitlement identifiers.
library ChallengeIds {
    string internal constant RELEASE_ID_DOMAIN = "challenge-escrow.release-id/v1";
    string internal constant CHALLENGE_ID_DOMAIN = "challenge-escrow.challenge-id/v1";
    string internal constant ENTITLEMENT_ID_DOMAIN = "challenge-escrow.entitlement-id/v1";

    function releaseId(uint256 chainId, address escrowContract) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(RELEASE_ID_DOMAIN, bytes1(0), chainId, escrowContract));
    }

    function challengeId(bytes32 specHash) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(CHALLENGE_ID_DOMAIN, bytes1(0), specHash));
    }

    function entitlementId(bytes32 challengeId_, address participantWallet)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encodePacked(ENTITLEMENT_ID_DOMAIN, bytes1(0), challengeId_, participantWallet)
        );
    }
}
