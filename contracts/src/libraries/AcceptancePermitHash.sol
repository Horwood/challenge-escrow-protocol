// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeTypes } from "../ChallengeTypes.sol";

/// @notice EIP-712 hashing for wallet-bound acceptance permits.
library AcceptancePermitHash {
    bytes32 internal constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 internal constant PERMIT_TYPEHASH = keccak256(
        "AcceptancePermit(bytes32 challengeId,bytes32 specHash,address acceptingWallet,uint256 acceptanceNonce,uint64 expiresAt)"
    );

    function domainSeparator(
        string memory name,
        string memory version,
        uint256 chainId,
        address verifyingContract
    ) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes(version)),
                chainId,
                verifyingContract
            )
        );
    }

    function structHash(ChallengeTypes.AcceptancePermit memory permit)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(
            abi.encode(
                PERMIT_TYPEHASH,
                permit.challengeId,
                permit.specHash,
                permit.acceptingWallet,
                permit.acceptanceNonce,
                permit.expiresAt
            )
        );
    }

    function digest(bytes32 domainSeparator_, ChallengeTypes.AcceptancePermit memory permit)
        internal
        pure
        returns (bytes32)
    {
        return keccak256(abi.encodePacked(hex"1901", domainSeparator_, structHash(permit)));
    }
}
