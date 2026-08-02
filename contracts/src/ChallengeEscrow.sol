// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import { ChallengeEscrowKernel } from "./ChallengeEscrowKernel.sol";

/// @notice Direct, non-upgradeable research release with an immutable independent pauser.
/// @dev The pauser cannot participate financially in a challenge.
contract ChallengeEscrow is ChallengeEscrowKernel {
    error ZeroPauser();
    error ResolverRoleOverlap(address resolver);
    error ArbiterRoleOverlap(address arbiter);
    error PauserRoleOverlap(address pauser);
    error CallerNotPauser(address caller);
    error PauseStatusUnchanged(bool paused);
    error ParticipantIsPauser(address wallet);

    address public immutable pauser;

    event PauseStatusChanged(address indexed changedBy, bool previousPaused, bool newPaused);

    constructor(
        address canonicalToken_,
        uint8 tokenDecimals_,
        address resolver_,
        address arbiter_,
        address pauser_,
        bool initialPaused_
    ) ChallengeEscrowKernel(canonicalToken_, tokenDecimals_, resolver_, arbiter_, initialPaused_) {
        if (resolver_ == canonicalToken_ || resolver_ == address(this)) {
            revert ResolverRoleOverlap(resolver_);
        }
        if (arbiter_ == canonicalToken_ || arbiter_ == address(this)) {
            revert ArbiterRoleOverlap(arbiter_);
        }
        if (pauser_ == address(0)) revert ZeroPauser();
        if (
            pauser_ == address(this) || pauser_ == canonicalToken_ || pauser_ == resolver_
                || pauser_ == arbiter_
        ) revert PauserRoleOverlap(pauser_);
        pauser = pauser_;
    }

    function setPaused(bool newPaused) external {
        if (msg.sender != pauser) revert CallerNotPauser(msg.sender);
        bool previousPaused = paused;
        if (newPaused == previousPaused) revert PauseStatusUnchanged(previousPaused);
        paused = newPaused;
        emit PauseStatusChanged(msg.sender, previousPaused, newPaused);
    }

    function _validateChallengerWallet(address wallet) internal view override {
        super._validateChallengerWallet(wallet);
        if (wallet == pauser) revert ParticipantIsPauser(wallet);
    }

    function _validateParticipantWallet(address wallet, address challengerWallet)
        internal
        view
        override
    {
        super._validateParticipantWallet(wallet, challengerWallet);
        if (wallet == pauser) revert ParticipantIsPauser(wallet);
    }
}
